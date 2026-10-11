// Package syncer keeps the jobs table in step with every company's job
// board. Every five minutes it reads each board and compares it with what
// we stored: new postings are added, changed ones updated, and ones gone
// from the board closed. A company's first sync is its baseline and emails
// nobody; after that, each new job is matched against the people watching
// the company.
package syncer

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"jobdrop/internal/boards"
	"jobdrop/internal/metrics"
	"jobdrop/internal/model"
	"jobdrop/internal/notify"
	"jobdrop/internal/store"
)

type Syncer struct {
	db     store.DB
	boards map[model.Platform]boards.Board
	// Called after a sync queues emails (see notify.Sender.Wake).
	queued func()
	// Syncs of the same company take turns: the timer and the admin
	// "Publish" button can both sync a test company, and two syncs reading
	// the board at different moments could undo each other's work.
	// Different companies don't wait for each other. company id → *sync.Mutex.
	locks sync.Map
	// Each board's ETag from its last saved sync: company id → string.
	etags sync.Map
}

func New(db store.DB, boards map[model.Platform]boards.Board, queued func()) *Syncer {
	return &Syncer{db: db, boards: boards, queued: queued}
}

// Result counts what one company's sync did. Unchanged means the board
// answered "nothing changed since the last sync", so nothing was read.
type Result struct {
	Discovered, Created, Updated, Reopened, Closed, Queued int
	Unchanged                                              bool
}

func (r Result) Summary() string {
	if r.Unchanged {
		return "unchanged since the last sync"
	}
	text := fmt.Sprintf("discovered %d", r.Discovered)
	if r.Created > 0 {
		text += fmt.Sprintf(", %d new", r.Created)
	}
	if r.Updated > 0 {
		text += fmt.Sprintf(", %d updated", r.Updated)
	}
	if r.Reopened > 0 {
		text += fmt.Sprintf(", %d reopened", r.Reopened)
	}
	if r.Closed > 0 {
		text += fmt.Sprintf(", %d closed", r.Closed)
	}
	if r.Queued > 0 {
		text += fmt.Sprintf(", %d notification(s) queued", r.Queued)
	}
	return text
}

// SyncAll syncs every active company: one round, run by main.go ten
// seconds after startup, then five minutes after each round ends. One
// company failing (its board is down, say) doesn't stop the others.
func (s *Syncer) SyncAll(ctx context.Context) error {
	start := time.Now()
	companies, err := store.ActiveCompanies(ctx, s.db)
	if err != nil {
		return err
	}
	failed, unchanged := 0, 0
	for _, company := range companies {
		if ctx.Err() != nil {
			return ctx.Err() // shutting down
		}
		result, err := s.Sync(ctx, company)
		if err != nil {
			failed++
			metrics.BoardFetchFailures.WithLabelValues(company.Slug).Inc()
			slog.Warn(company.Name+": sync failed", "error", err)
			continue
		}
		if result.Unchanged {
			unchanged++
		}
		if result.Created+result.Updated+result.Reopened+result.Closed > 0 {
			slog.Info(company.Name + ": " + result.Summary())
		}
	}
	slog.Info(fmt.Sprintf("Synced %d companies (%d unchanged, %d failed)", len(companies), unchanged, failed))

	metrics.SyncRoundDuration.Observe(time.Since(start).Seconds())
	metrics.SyncLastSuccess.SetToCurrentTime()
	if open, err := store.CountOpenJobs(ctx, s.db); err == nil {
		metrics.OpenJobs.Set(float64(open))
	}
	return nil
}

// Sync syncs one company: it reads the board (a network call, kept outside
// the database transaction), then saves the differences in one transaction.
func (s *Syncer) Sync(ctx context.Context, company model.Company) (Result, error) {
	lock, _ := s.locks.LoadOrStore(company.ID, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()

	board, ok := s.boards[company.Platform]
	if !ok {
		return Result{}, fmt.Errorf("no board for platform %s", company.Platform)
	}
	lastETag, _ := s.etags.Load(company.ID)
	start := time.Now()
	posted, etag, err := board.Fetch(ctx, company, stringOrEmpty(lastETag))
	metrics.BoardFetchDuration.WithLabelValues(string(company.Platform)).Observe(time.Since(start).Seconds())
	if errors.Is(err, boards.ErrNotModified) {
		// The board is as we saved it last time: only note that we looked
		// (the website shows when a company was last checked).
		return Result{Unchanged: true}, store.MarkCompanySynced(ctx, s.db, company.ID, model.Now())
	}
	if err != nil {
		return Result{}, err
	}

	var result Result
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		var saveErr error
		result, saveErr = save(ctx, tx, company.ID, posted)
		return saveErr
	})
	if err != nil {
		return Result{}, err
	}
	// Only now, with this version of the board saved, is its tag worth
	// sending next time. (An empty answer isn't saved as a baseline, so its
	// tag isn't kept either.)
	if etag != "" && len(posted) > 0 {
		s.etags.Store(company.ID, etag)
	}
	if result.Queued > 0 && s.queued != nil {
		s.queued()
	}
	metrics.JobChanges.WithLabelValues("created").Add(float64(result.Created))
	metrics.JobChanges.WithLabelValues("updated").Add(float64(result.Updated))
	metrics.JobChanges.WithLabelValues("reopened").Add(float64(result.Reopened))
	metrics.JobChanges.WithLabelValues("closed").Add(float64(result.Closed))
	metrics.Emails.WithLabelValues("queued").Add(float64(result.Queued))
	return result, nil
}

func stringOrEmpty(value any) string {
	text, _ := value.(string)
	return text
}

func save(ctx context.Context, tx pgx.Tx, companyID string, posted []model.Posting) (Result, error) {
	company, err := store.CompanyByID(ctx, tx, companyID)
	if err != nil {
		return Result{}, err
	}
	baseline := !company.InitialSyncDone
	now := model.Now()

	// A board that answers with no jobs on its very first sync is more
	// likely broken than empty. Recording that as the baseline would make
	// every job after it look new, so wait for a real answer. (Test
	// companies start out baselined: see the admin API's createTestCompany.)
	if baseline && len(posted) == 0 {
		return Result{}, nil
	}

	known, err := store.JobsOfCompany(ctx, tx, companyID)
	if err != nil {
		return Result{}, err
	}
	stored := make(map[string]model.Job, len(known))
	for _, job := range known {
		stored[job.ExternalID] = job
	}

	var result Result
	var inserted, changed, newJobs []model.Job
	seen := map[string]bool{}
	for _, post := range posted {
		if seen[post.ExternalID] {
			continue // listed twice on the board
		}
		seen[post.ExternalID] = true
		job, found := stored[post.ExternalID]
		delete(stored, post.ExternalID)

		if !found {
			job = model.Job{ID: uuid.NewString(), ExternalID: post.ExternalID, DiscoveredInInitialSync: baseline,
				FirstSeenAt: now, UpdatedAt: now, Company: *company}
			job.Update(post, now)
			inserted = append(inserted, job)
			result.Created++
			if !baseline {
				newJobs = append(newJobs, job)
			}
			continue
		}
		wasClosed := job.Status == model.Closed
		if job.Update(post, now) {
			changed = append(changed, job)
			if wasClosed {
				result.Reopened++
			} else {
				result.Updated++
			}
		}
	}

	// Whatever is left in "stored" is no longer on the board. An empty reply
	// is never trusted to close everything: a board doesn't empty out in
	// five minutes, but a broken reply can look empty.
	if len(posted) > 0 {
		for _, gone := range stored {
			if gone.Status == model.Active {
				gone.Close(now)
				changed = append(changed, gone)
				result.Closed++
			}
		}
	}
	// Every insert and update in one round trip to the database.
	if err := store.SaveJobs(ctx, tx, inserted, changed); err != nil {
		return Result{}, err
	}
	if err := store.MarkCompanySynced(ctx, tx, companyID, now); err != nil {
		return Result{}, err
	}

	for _, job := range newJobs {
		queued, err := notify.QueueForNewJob(ctx, tx, job)
		if err != nil {
			return Result{}, err
		}
		result.Queued += queued
	}
	result.Discovered = len(seen)
	return result, nil
}
