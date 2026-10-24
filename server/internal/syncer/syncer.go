// Package syncer keeps the stored jobs in step with every company's job
// board. Every five minutes it reads each board and compares it with what
// we stored: new postings are added, changed ones updated, and ones gone
// from the board closed. A company's first sync is its baseline and emails
// nobody; after that, each new job is matched against the people watching
// the company.
package syncer

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"jobdrop/internal/boards"
	"jobdrop/internal/metrics"
	"jobdrop/internal/model"
	"jobdrop/internal/notify"
	"jobdrop/internal/store"
)

type Syncer struct {
	db     *store.DB
	boards map[model.Platform]boards.Board
	// Called after a sync queues emails (see notify.Sender.Wake).
	queued func()
	// Syncs of the same company take turns: the timer and the admin
	// "Publish" button can both sync a test company, and two syncs reading
	// the board at different moments could undo each other's work.
	// Different companies don't wait for each other. company slug → *sync.Mutex.
	locks sync.Map
	// Each board's ETag from its last saved sync: company slug → string.
	etags sync.Map
}

func New(db *store.DB, boards map[model.Platform]boards.Board, queued func()) *Syncer {
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

// Sync syncs one company: it reads the board, then saves the differences.
func (s *Syncer) Sync(ctx context.Context, company model.Company) (Result, error) {
	lock, _ := s.locks.LoadOrStore(company.Slug, &sync.Mutex{})
	lock.(*sync.Mutex).Lock()
	defer lock.(*sync.Mutex).Unlock()

	board, ok := s.boards[company.Platform]
	if !ok {
		return Result{}, fmt.Errorf("no board for platform %s", company.Platform)
	}
	lastETag, _ := s.etags.Load(company.Slug)
	start := time.Now()
	posted, etag, err := board.Fetch(ctx, company, stringOrEmpty(lastETag))
	metrics.BoardFetchDuration.WithLabelValues(string(company.Platform)).Observe(time.Since(start).Seconds())
	if errors.Is(err, boards.ErrNotModified) {
		// The board is as we saved it last time: only note that we looked
		// (the website shows when a company was last checked).
		return Result{Unchanged: true}, store.MarkCompanyChecked(ctx, s.db, company.Slug, model.Now())
	}
	if err != nil {
		return Result{}, err
	}

	result, err := save(ctx, s.db, company.Slug, posted)
	if err != nil {
		return Result{}, err
	}
	// Only now, with this version of the board saved, is its tag worth
	// sending next time. (An empty answer isn't saved as a baseline, so its
	// tag isn't kept either.)
	if etag != "" && len(posted) > 0 {
		s.etags.Store(company.Slug, etag)
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

// save writes what changed on the board. It can't be one transaction, as
// with SQL: a DynamoDB transaction takes 100 items, and a company's first
// sync writes up to thousands. Instead every step is safe to repeat, so a
// sync that stops halfway (an error, a restart) is finished by the next:
//   - New jobs are written only if their id is still free, changed ones only
//     if they exist, so two syncs at once can't both add the same job.
//   - A new job is saved with NotifyPending set. Its emails are queued, each
//     only if that user has no email about the job yet, and then the flag
//     is cleared. A sync that finds the flag still set queues them again,
//     which sends nobody a second email.
//   - The company is marked synced last, so a baseline that stopped halfway
//     is still a baseline next time, and its fingerprint only claims a
//     board whose every change was saved.
func save(ctx context.Context, db *store.DB, slug string, posted []model.Posting) (Result, error) {
	company, err := store.CompanyBySlug(ctx, db, slug)
	if err != nil {
		return Result{}, err
	}
	if company == nil {
		return Result{}, fmt.Errorf("company %q not found", slug)
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

	posted = onlyFirst(posted)
	fingerprint := fingerprintOf(posted)
	if !baseline && fingerprint == company.BoardFingerprint {
		// The board says exactly what it said when last saved: there's
		// nothing to compare, so the jobs aren't even read.
		return Result{Discovered: len(posted), Unchanged: true}, store.MarkCompanyChecked(ctx, db, slug, now)
	}

	known, err := store.JobsOfCompany(ctx, db, *company)
	if err != nil {
		return Result{}, err
	}
	stored := make(map[string]model.Job, len(known))
	for _, job := range known {
		stored[job.ExternalID] = job
	}

	var result Result
	var inserted, changed, notifyFor, saved []model.Job
	for _, post := range posted {
		job, found := stored[post.ExternalID]
		delete(stored, post.ExternalID)

		if !found {
			job = model.Job{ID: model.JobID(slug, post.ExternalID), ExternalID: post.ExternalID,
				DiscoveredInInitialSync: baseline, FirstSeenAt: now, UpdatedAt: now, NotifyPending: !baseline,
				Company: *company}
			job.Update(post, now)
			inserted = append(inserted, job)
			saved = append(saved, job)
			result.Created++
			if !baseline {
				notifyFor = append(notifyFor, job)
			}
			continue
		}
		if job.NotifyPending { // left by a sync that stopped halfway
			notifyFor = append(notifyFor, job)
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
		saved = append(saved, job)
	}

	// Whatever is left in "stored" is no longer on the board. An empty reply
	// is never trusted to close everything: a board doesn't empty out in
	// five minutes, but a broken reply can look empty.
	for _, gone := range stored {
		if gone.Status == model.Active && len(posted) > 0 {
			gone.Close(now)
			changed = append(changed, gone)
			result.Closed++
		}
		saved = append(saved, gone)
	}
	if err := store.SaveJobs(ctx, db, inserted, changed); err != nil {
		return Result{}, err
	}

	if len(notifyFor) > 0 {
		watchers, err := store.WatchersOf(ctx, db, slug)
		if err != nil {
			return Result{}, err
		}
		for _, job := range notifyFor {
			queued, err := notify.QueueForNewJob(ctx, db, job, watchers)
			if err != nil {
				return Result{}, err
			}
			result.Queued += queued
			if err := store.ClearNotifyPending(ctx, db, job); err != nil {
				return Result{}, err
			}
		}
	}
	if err := store.MarkCompanySynced(ctx, db, slug, now, fingerprint, saved); err != nil {
		return Result{}, err
	}
	result.Discovered = len(posted)
	return result, nil
}

// onlyFirst drops postings listed twice on the board, keeping the first.
func onlyFirst(posted []model.Posting) []model.Posting {
	seen := map[string]bool{}
	return slices.DeleteFunc(slices.Clone(posted), func(p model.Posting) bool {
		duplicate := seen[p.ExternalID]
		seen[p.ExternalID] = true
		return duplicate
	})
}

// fingerprintOf is a hash of everything the sync saves from the postings,
// in a fixed order. Two reads of a board with the same fingerprint would
// save the same jobs, so the second needn't read or write any.
func fingerprintOf(posted []model.Posting) string {
	sorted := slices.SortedFunc(slices.Values(posted), func(a, b model.Posting) int {
		return cmp.Compare(a.ExternalID, b.ExternalID)
	})
	encoded, _ := json.Marshal(sorted) // plain data: it always encodes
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}
