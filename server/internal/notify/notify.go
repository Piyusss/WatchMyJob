// Package notify turns new jobs into emails, in two steps. QueueForNewJob
// (called by the sync) records who should hear about a job; a Sender (on a
// timer) sends those emails. The queue means a slow or failing email
// provider never holds up the sync, and failed sends can be retried.
package notify

import (
	"context"
	"log/slog"
	"sync/atomic"

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
	// Whether anything may be waiting to be sent: set at startup (for
	// whatever was queued before a restart), by Wake, and while a failed
	// send waits for its retry. While it's unset, a round doesn't ask the
	// database at all, which spares the table's read capacity.
	pending atomic.Bool
}

func NewSender(db *store.DB, mailer Mailer, frontendURL string) *Sender {
	s := &Sender{db: db, mailer: mailer, frontendURL: frontendURL}
	s.pending.Store(true)
	return s
}

// Wake tells the sender that emails were just queued; the next round sends them.
func (s *Sender) Wake() {
	s.pending.Store(true)
}

// SendQueued sends what is queued, oldest first: one round, run every 15
// seconds by main.go.
func (s *Sender) SendQueued(ctx context.Context) error {
	if !s.pending.Swap(false) {
		return nil // nothing was queued since the last round
	}
	// Look again next round unless this one leaves the queue empty (more
	// than a batch, or a failed send waiting for its retry, or an error).
	again := true
	defer func() {
		if again {
			s.pending.Store(true)
		}
	}()

	queue, err := store.QueuedNotifications(ctx, s.db, batchSize)
	if err != nil {
		return err
	}
	for _, n := range queue {
		if err := s.send(ctx, &n); err != nil {
			return err
		}
		if err := store.SaveNotification(ctx, s.db, n); err != nil {
			return err
		}
	}
	waiting, err := store.CountQueuedNotifications(ctx, s.db)
	if err != nil {
		return err
	}
	metrics.EmailQueueDepth.Set(float64(waiting))
	again = waiting > 0
	return nil
}

// send tries one email and records the outcome on n. Only a database
// error is returned; a failed send is part of the outcome.
func (s *Sender) send(ctx context.Context, n *model.Notification) error {
	reason, err := s.reasonNotToSend(ctx, *n)
	if err != nil {
		return err
	}
	if reason != "" {
		n.MarkSkipped(reason)
		metrics.Emails.WithLabelValues("skipped").Inc()
		return nil
	}

	unsubscribeURL := s.frontendURL + "/unsubscribe?token=" + n.User.UnsubscribeToken
	email, err := JobAlert(n.User, n.Job, unsubscribeURL)
	if err == nil {
		err = s.mailer.Send(ctx, n.User.Email, email)
	}
	if err != nil {
		slog.Warn("Email failed", "to", n.User.Email, "error", err)
		n.MarkFailedAttempt(err.Error())
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
