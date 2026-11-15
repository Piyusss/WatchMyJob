// Package notify turns new jobs into emails, in two steps. QueueForNewJob
// (called by the sync) records who should hear about a job; a Sender (on a
// timer) sends those emails. The queue means a slow or failing email
// provider never holds up the sync, and failed sends are retried later.
package notify

import (
	"context"
	"log/slog"
	"net/mail"
	"sync"
	"time"

	"jobdrop/internal/matching"
	"jobdrop/internal/metrics"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// batchSize is how many emails one round sends at most.
const batchSize = 20

// QueueForNewJob queues an email for each of the company's watchers (the
// sync loads them once for all its new jobs) whose preferences the job
// matches, and returns how many it queued. Someone who already has an
// email about the job, from a sync that stopped halfway, isn't queued again.
func QueueForNewJob(ctx context.Context, db *store.DB, job model.Job, watchers []store.Watcher) (int, error) {
	queued := 0
	for _, watcher := range watchers {
		// Someone who hasn't set preferences yet isn't sent anything.
		if watcher.Preferences == nil || !matching.Matches(job, *watcher.Preferences) {
			continue
		}
		added, err := store.QueueNotification(ctx, db, watcher.User.ID, job.ID)
		if err != nil {
			return queued, err
		}
		if added {
			queued++
		}
	}
	return queued, nil
}

// Sender sends the queued emails.
type Sender struct {
	db          *store.DB
	mailer      Mailer
	frontendURL string
	now         func() time.Time // the clock: model.Now, which tests move forward

	// When the next round should look at the queue. The zero time means at
	// once: at startup (for whatever was queued before a restart) and after
	// Wake. With nothing queued it's never, and with only retries waiting
	// it's when the first falls due. Until then a round doesn't ask the
	// database at all, which spares the table's read capacity.
	mu       sync.Mutex
	nextLook time.Time
}

// never is a time no round reaches: the sender waits for Wake.
var never = time.Date(9999, time.January, 1, 0, 0, 0, 0, time.UTC)

func NewSender(db *store.DB, mailer Mailer, frontendURL string) *Sender {
	return &Sender{db: db, mailer: mailer, frontendURL: frontendURL, now: model.Now}
}

// Wake tells the sender that emails were just queued; the next round sends them.
func (s *Sender) Wake() {
	s.lookBy(time.Time{})
}

// lookBy brings the next look forward to t, if that's sooner: it never
// puts one off, so a Wake during a round isn't lost.
func (s *Sender) lookBy(t time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t.Before(s.nextLook) {
		s.nextLook = t
	}
}

// SendQueued sends the queued emails that are due, the longest-waiting
// first: one round, run every 15 seconds by main.go.
func (s *Sender) SendQueued(ctx context.Context) error {
	now := s.now()
	s.mu.Lock()
	if now.Before(s.nextLook) {
		s.mu.Unlock()
		return nil // nothing has fallen due or been queued since the last look
	}
	s.nextLook = never
	s.mu.Unlock()
	// Unless this round finds out when the queue next needs a look, look
	// again next round (after an error, say).
	next := time.Time{}
	defer func() { s.lookBy(next) }()

	queue, err := store.DueNotifications(ctx, s.db, now, batchSize)
	if err != nil {
		return err
	}
	for _, n := range queue {
		if err := s.send(ctx, &n, now); err != nil {
			return err
		}
		if err := store.SaveNotification(ctx, s.db, n); err != nil {
			return err
		}
	}
	waiting, firstDue, err := store.QueueStatus(ctx, s.db)
	if err != nil {
		return err
	}
	metrics.EmailQueueDepth.Set(float64(waiting))
	next = firstDue // already past if more than a batch was due
	if waiting == 0 {
		next = never
	}
	return nil
}

// send tries one email and records the outcome on n. Only a database
// error is returned; a failed send is part of the outcome.
func (s *Sender) send(ctx context.Context, n *model.Notification, now time.Time) error {
	reason, err := s.reasonNotToSend(ctx, *n)
	if err != nil {
		return err
	}
	if reason != "" {
		n.MarkSkipped(reason)
		metrics.Emails.WithLabelValues("skipped").Inc()
		return nil
	}
	// An address that isn't an email address would fail every time, so
	// it's given up on at once. Every other failure is retried, Brevo's
	// errors included: its status codes don't tell a problem with this email
	// apart from one with the account (a sender that isn't verified yet, the
	// day's quota used up), and those can be fixed or wait out.
	if _, err := mail.ParseAddress(n.User.Email); err != nil {
		n.MarkUndeliverable("not a valid email address")
		metrics.Emails.WithLabelValues("failed").Inc()
		return nil
	}

	unsubscribeURL := s.frontendURL + "/unsubscribe?token=" + n.User.UnsubscribeToken
	email, err := JobAlert(n.User, n.Job, unsubscribeURL)
	if err == nil {
		err = s.mailer.Send(ctx, n.User.Email, email)
	}
	if err != nil {
		slog.Warn("Email failed", "to", n.User.Email, "error", err)
		n.MarkFailedAttempt(err.Error(), now)
		if n.Status == model.Failed {
			metrics.Emails.WithLabelValues("failed").Inc()
		} else {
			metrics.Emails.WithLabelValues("failed_attempt").Inc()
		}
		return nil
	}
	n.MarkSent(model.Now())
	metrics.Emails.WithLabelValues("sent").Inc()
	return nil
}

// reasonNotToSend is checked again right before sending, because things
// change after an email is queued: the job can close, the user can pause
// alerts or stop watching the company.
func (s *Sender) reasonNotToSend(ctx context.Context, n model.Notification) (string, error) {
	switch {
	case n.Job.Status != model.Active:
		return "job is no longer open", nil
	case !n.Job.Company.Active:
		return "company is switched off", nil
	case n.User.NotificationsPaused:
		return "user paused notifications", nil
	case !n.User.EmailVerified:
		return "user's email is not verified", nil
	}
	watching, err := store.IsWatching(ctx, s.db, n.User.ID, n.Job.Company.Slug)
	if err != nil || watching {
		return "", err
	}
	return "user stopped watching the company", nil
}
