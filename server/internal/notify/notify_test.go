package notify

import (
	"context"
	"errors"
	"strings"
	"testing"

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

// stored is the user's notification about the job, as stored.
func stored(t *testing.T, user model.User, job model.Job) (status model.NotificationStatus, attempts int, lastError *string) {
	t.Helper()
	n, err := store.NotificationOf(context.Background(), testdb.DB, user.ID, job.ID)
	if err != nil || n == nil {
		t.Fatalf("no notification: %v", err)
	}
	return n.Status, n.Attempts, n.LastError
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
	if status, _, _ := stored(t, user, job); status != model.ProviderAccepted {
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
	if status, _, _ := stored(t, user, job); status != model.Skipped {
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
	if status, _, _ := stored(t, user, job); status != model.Skipped {
		t.Errorf("status %s, want SKIPPED", status)
	}
}

// Between rounds with nothing to send, the sender doesn't ask the database:
// it looks at the queue when it starts, when woken, and while sends fail.
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

func TestAFailedSendIsRetriedThenGivenUpOn(t *testing.T) {
	mailer := &fakeMailer{fail: errors.New("Brevo is down")}
	sender := NewSender(testdb.DB, mailer, "https://watchmyjob.co")
	user := testdb.User(t, testdb.Unique("unlucky")+"@example.com")
	_, job := queuedFor(t, user, "Backend Engineer")

	sendQueued(t, sender)
	if status, _, _ := stored(t, user, job); status != model.Queued {
		t.Errorf("status %s, want QUEUED (to be retried)", status)
	}
	sendQueued(t, sender)
	sendQueued(t, sender)

	status, attempts, lastError := stored(t, user, job)
	if status != model.Failed || attempts != model.MaxAttempts || lastError == nil || *lastError != "Brevo is down" {
		t.Errorf("got %s after %d attempts (%v)", status, attempts, lastError)
	}
}
