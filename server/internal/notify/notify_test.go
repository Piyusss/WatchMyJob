package notify

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
	"jobdrop/internal/testdb"
)

func TestMain(m *testing.M) {
	testdb.Run(m)
}

// fakeMailer records what it's asked to send, or fails every send.
type fakeMailer struct {
	sent []sentEmail
	fail error
}

type sentEmail struct {
	to    string
	email Email
}

func (f *fakeMailer) Send(_ context.Context, to string, email Email) error {
	if f.fail != nil {
		return f.fail
	}
	f.sent = append(f.sent, sentEmail{to, email})
	return nil
}

// queuedFor queues an email about a new job for a user who watches its
// company. Each test starts with an empty queue, so it sends only its own email.
func queuedFor(t *testing.T, user model.User, title string) (company model.Company, job model.Job) {
	t.Helper()
	testdb.EmptyQueue(t)
	return queue(t, user, title)
}

// queue is queuedFor without emptying the queue first.
func queue(t *testing.T, user model.User, title string) (company model.Company, job model.Job) {
	t.Helper()
	company = testdb.WatchableCompany(t)
	job = testdb.OpenJob(t, company, title)
	testdb.Watch(t, user, company)
	if _, err := store.QueueNotification(context.Background(), testdb.DB, user.ID, job.ID); err != nil {
		t.Fatal(err)
	}
	return company, job
}

func sendQueued(t *testing.T, sender *Sender) {
	t.Helper()
	if err := sender.SendQueued(context.Background()); err != nil {
		t.Fatal(err)
	}
}

// withClock makes the sender's time stand still at the returned clock,
// which the test then moves.
func withClock(sender *Sender) *time.Time {
	clock := model.Now()
	sender.now = func() time.Time { return clock }
	return &clock
}

// stored is the user's notification about the job, as stored.
func stored(t *testing.T, user model.User, job model.Job) model.Notification {
	t.Helper()
	n, err := store.NotificationOf(context.Background(), testdb.DB, user.ID, job.ID)
	if err != nil || n == nil {
		t.Fatalf("no notification: %v", err)
	}
	return *n
}

func TestAQueuedEmailIsSentAndMarkedSent(t *testing.T) {
	mailer := &fakeMailer{}
	user := testdb.User(t, testdb.Unique("ada")+"@example.com")
	_, job := queuedFor(t, user, "Backend Engineer")

	sendQueued(t, NewSender(testdb.DB, mailer, "https://watchmyjob.co"))

	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(mailer.sent))
	}
	sent := mailer.sent[0]
	if sent.to != user.Email || sent.email.Subject != "New job match: Backend Engineer at Test Co" {
		t.Errorf("sent %q to %s", sent.email.Subject, sent.to)
	}
	if !strings.Contains(sent.email.HTML, "https://watchmyjob.co/unsubscribe?token="+user.UnsubscribeToken) {
		t.Error("the email should have the user's unsubscribe link")
	}
	if status := stored(t, user, job).Status; status != model.ProviderAccepted {
		t.Errorf("status %s, want PROVIDER_ACCEPTED", status)
	}
}

func TestNothingIsSentToSomeoneWhoPausedAlerts(t *testing.T) {
	mailer := &fakeMailer{}
	user := testdb.User(t, testdb.Unique("paused")+"@example.com")
	if err := store.SetNotificationsPaused(context.Background(), testdb.DB, user.ID, true); err != nil {
		t.Fatal(err)
	}
	_, job := queuedFor(t, user, "Backend Engineer")

	sendQueued(t, NewSender(testdb.DB, mailer, "https://watchmyjob.co"))

	if len(mailer.sent) != 0 {
		t.Error("nothing should be sent")
	}
	if status := stored(t, user, job).Status; status != model.Skipped {
		t.Errorf("status %s, want SKIPPED", status)
	}
}

func TestNothingIsSentAboutAJobThatClosedWhileQueued(t *testing.T) {
	mailer := &fakeMailer{}
	user := testdb.User(t, testdb.Unique("late")+"@example.com")
	_, job := queuedFor(t, user, "Backend Engineer")
	job.Close(model.Now())
	if err := store.UpdateJob(context.Background(), testdb.DB, job); err != nil {
		t.Fatal(err)
	}

	sendQueued(t, NewSender(testdb.DB, mailer, "https://watchmyjob.co"))

	if len(mailer.sent) != 0 {
		t.Error("nothing should be sent")
	}
	if status := stored(t, user, job).Status; status != model.Skipped {
		t.Errorf("status %s, want SKIPPED", status)
	}
}

// Between rounds with nothing to send, the sender doesn't ask the database:
// it looks at the queue when it starts, when woken, and when a retry falls due.
func TestTheSenderOnlyLooksAtTheQueueWhenWoken(t *testing.T) {
	mailer := &fakeMailer{}
	sender := NewSender(testdb.DB, mailer, "https://watchmyjob.co")
	user := testdb.User(t, testdb.Unique("woken")+"@example.com")
	queuedFor(t, user, "Backend Engineer")
	sendQueued(t, sender) // a new sender always looks once
	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d emails, want 1", len(mailer.sent))
	}

	queuedFor(t, user, "Data Engineer") // queued without waking the sender
	sendQueued(t, sender)
	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d emails before being woken, want 1", len(mailer.sent))
	}
	sender.Wake()
	sendQueued(t, sender)
	if len(mailer.sent) != 2 {
		t.Errorf("sent %d emails after being woken, want 2", len(mailer.sent))
	}
}

// A failed send waits longer before each retry (a minute, then four times
// longer each time), so a provider outage of up to about a day delays the
// email instead of losing it. After MaxAttempts tries it's given up on.
func TestAFailedSendIsRetriedLaterAndLaterThenGivenUpOn(t *testing.T) {
	mailer := &fakeMailer{fail: errors.New("Brevo is down")}
	sender := NewSender(testdb.DB, mailer, "https://watchmyjob.co")
	user := testdb.User(t, testdb.Unique("unlucky")+"@example.com")
	_, job := queuedFor(t, user, "Backend Engineer")
	clock := withClock(sender)
	start := *clock

	sendQueued(t, sender)
	first := stored(t, user, job)
	if first.Status != model.Queued || first.Attempts != 1 || first.NextAttemptAt.Sub(start) != time.Minute {
		t.Fatalf("after one try: %s, %d attempts, due %v later; want QUEUED, 1, in a minute",
			first.Status, first.Attempts, first.NextAttemptAt.Sub(start))
	}
	*clock = start.Add(30 * time.Second) // not due yet
	sendQueued(t, sender)
	if attempts := stored(t, user, job).Attempts; attempts != 1 {
		t.Fatalf("tried again before it was due: %d attempts", attempts)
	}

	for range model.MaxAttempts - 1 {
		*clock = stored(t, user, job).NextAttemptAt // no Wake: the sender looks when a retry falls due
		sendQueued(t, sender)
	}
	n := stored(t, user, job)
	if n.Status != model.Failed || n.Attempts != model.MaxAttempts || n.LastError == nil || *n.LastError != "Brevo is down" {
		t.Errorf("got %s after %d attempts (%v)", n.Status, n.Attempts, n.LastError)
	}
	if lastTry := clock.Sub(start); lastTry < 22*time.Hour || lastTry > 24*time.Hour {
		t.Errorf("the last try came %v after the first, want about a day", lastTry)
	}
}

// An address that isn't an email address can't ever be sent to, so it
// isn't tried at all.
func TestAnInvalidAddressIsGivenUpOnAtOnce(t *testing.T) {
	mailer := &fakeMailer{}
	user := testdb.User(t, testdb.Unique("no-at-sign"))
	_, job := queuedFor(t, user, "Backend Engineer")

	sendQueued(t, NewSender(testdb.DB, mailer, "https://watchmyjob.co"))

	if n := stored(t, user, job); n.Status != model.Failed || n.Attempts != 0 || len(mailer.sent) != 0 {
		t.Errorf("got %s after %d attempts, %d sent; want FAILED, untried", n.Status, n.Attempts, len(mailer.sent))
	}
}

// The queue is sorted by when each email is due, so one waiting for its
// retry doesn't hold up an email queued after it.
func TestARetryWaitingForLaterDoesNotHoldUpNewEmails(t *testing.T) {
	mailer := &fakeMailer{fail: errors.New("Brevo is down")}
	sender := NewSender(testdb.DB, mailer, "https://watchmyjob.co")
	user := testdb.User(t, testdb.Unique("patient")+"@example.com")
	_, waiting := queuedFor(t, user, "Backend Engineer")
	sendQueued(t, sender) // fails: due again in a minute

	mailer.fail = nil
	_, fresh := queue(t, user, "Data Engineer")
	sender.Wake()
	sendQueued(t, sender)

	if status := stored(t, user, fresh).Status; status != model.ProviderAccepted {
		t.Errorf("the new email: %s, want PROVIDER_ACCEPTED", status)
	}
	if n := stored(t, user, waiting); n.Status != model.Queued || n.Attempts != 1 {
		t.Errorf("the waiting retry: %s after %d attempts, want QUEUED after 1", n.Status, n.Attempts)
	}
}
