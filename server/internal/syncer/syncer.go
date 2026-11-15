// Package syncer keeps the stored jobs in step with every company's job
// board. Every five minutes it reads each board and compares it with what
// we stored: new postings are added, changed ones updated, and ones gone
// from the board closed. A company's first sync is its baseline and emails
// nobody; after that, each new job is matched against the people watching
// the company. A board that answers with no jobs at all is only believed
// once it has stayed that way for emptyFor, and a company that's switched
// off has its jobs closed, as nobody reads its board any more.
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
	// the board at different moments could undo each other's work. So does
	// StopFollowing. Different companies don't wait for each other.
	// company slug → *sync.Mutex.
	locks sync.Map
	// Each board's ETag from its last saved sync: company slug → string.
	etags sync.Map
}

func New(db *store.DB, boards map[model.Platform]boards.Board, queued func()) *Syncer {
	return &Syncer{db: db, boards: boards, queued: queued}
}

// emptyFor is how long a board must keep answering with no jobs, or saying
// it doesn't exist, before that's believed and its jobs close. A broken
// reply can look empty, but a board doesn't stay empty for hours by mistake.
const emptyFor = 6 * time.Hour

// errSwitchedOff: the company was switched off after this sync began, so
// the sync saves nothing (see StopFollowing).
var errSwitchedOff = errors.New("the company was switched off")

// lock waits for the company's turn (see Syncer.locks) and returns the
// function that ends it.
func (s *Syncer) lock(slug string) (unlock func()) {
	mu, _ := s.locks.LoadOrStore(slug, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	return mu.(*sync.Mutex).Unlock
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
// company failing (its board is down, say) doesn't stop the others. A
// company switched off since (dropped from companies.json, or by an admin)
// that still counts open jobs has them closed.
func (s *Syncer) SyncAll(ctx context.Context) error {
	start := time.Now()
	companies, err := store.Companies(ctx, s.db)
	if err != nil {
		return err
	}
	active, failed, unchanged := 0, 0, 0
	for _, company := range companies {
		if ctx.Err() != nil {
			return ctx.Err() // shutting down
		}
		if !company.Active {
			if company.OpenJobs > 0 {
				closed, err := s.StopFollowing(ctx, company)
				if err != nil {
					slog.Warn(company.Name+": closing the jobs of a switched-off company failed", "error", err)
				} else {
					slog.Info(fmt.Sprintf("%s: switched off, %d job(s) closed", company.Name, closed))
				}
			}
			continue
		}
		active++
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
	slog.Info(fmt.Sprintf("Synced %d companies (%d unchanged, %d failed)", active, unchanged, failed))

	metrics.SyncRoundDuration.Observe(time.Since(start).Seconds())
	metrics.SyncLastSuccess.SetToCurrentTime()
	if open, err := store.CountOpenJobs(ctx, s.db); err == nil {
		metrics.OpenJobs.Set(float64(open))
	}
	return nil
}

// Sync syncs one company: it reads the board, then saves the differences.
func (s *Syncer) Sync(ctx context.Context, company model.Company) (Result, error) {
	unlock := s.lock(company.Slug)
	defer unlock()

	board, ok := s.boards[company.Platform]
	if !ok {
		return Result{}, fmt.Errorf("no board for platform %s", company.Platform)
	}
	lastETag, _ := s.etags.Load(company.Slug)
	start := time.Now()
	posted, etag, err := board.Fetch(ctx, company, stringOrEmpty(lastETag))
	metrics.BoardFetchDuration.WithLabelValues(string(company.Platform)).Observe(time.Since(start).Seconds())
	switch {
	case errors.Is(err, boards.ErrNotModified):
		// The board is as we saved it last time: only note that we looked
		// (the website shows when a company was last checked).
		return Result{Unchanged: true}, store.MarkCompanyChecked(ctx, s.db, company.Slug, model.Now())
	case errors.Is(err, boards.ErrNoBoard):
		// A board that isn't there lists no jobs: saved as an empty board,
		// whose jobs close once it has lasted (see save). Someone should
		// look, though, so it's logged and counted as a failure too.
		slog.Warn(company.Name+": the board wasn't found; it counts as empty", "error", err)
		metrics.BoardFetchFailures.WithLabelValues(company.Slug).Inc()
		posted, etag = nil, ""
	case err != nil:
		return Result{}, err
	}

	result, err := save(ctx, s.db, company.Slug, posted)
	if errors.Is(err, errSwitchedOff) {
		return Result{}, nil
	}
	if err != nil {
		return Result{}, err
	}
	// Only now, with this version of the board saved, is its tag worth
	// sending next time. An empty answer's tag isn't kept, and neither is
	// the one before it: that version's jobs may close while the board is
	// empty, and if the board then came back as it was, "304 Not Modified"
	// would keep them closed.
	switch {
	case len(posted) == 0:
		s.etags.Delete(company.Slug)
	case etag != "":
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
	if !company.Active {
		return Result{}, errSwitchedOff
	}
	baseline := !company.InitialSyncDone
	now := model.Now()

	if len(posted) == 0 {
		// A board that answers with no jobs on its very first sync is more
		// likely broken than empty. Recording that as the baseline would
		// make every job after it look new, so wait for a real answer.
		// (Test companies start out baselined: see the admin API's
		// createTestCompany.)
		if baseline {
			return Result{}, nil
		}
		// Later, it may be broken too, or the company may really have
		// stopped hiring, or left the platform. Its jobs close only once
		// the board has stayed empty for emptyFor.
		if company.EmptySince == nil || now.Sub(*company.EmptySince) < emptyFor {
			if company.EmptySince == nil {
				slog.Info(company.Name + ": the board lists no jobs; they close if it stays empty for " + emptyFor.String())
			}
			return Result{}, store.MarkBoardEmpty(ctx, db, slug, now)
		}
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

	// Whatever is left in "stored" is no longer on the board. (An empty
	// board only gets this far once it has stayed empty for emptyFor.)
	for _, gone := range stored {
		if gone.Status == model.Active {
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

// StopFollowing closes a switched-off company's open jobs, and returns how
// many there were: nobody reads its board any more, so nothing on it can
// be shown as open. Its role families and open-job count go with them. It
// also forgets the board's fingerprint and ETag, so that if the company is
// ever switched back on, its next sync compares the board in full, and
// reopens (without emailing anyone) what's still there.
func (s *Syncer) StopFollowing(ctx context.Context, company model.Company) (int, error) {
	unlock := s.lock(company.Slug)
	defer unlock()

	s.etags.Delete(company.Slug)
	jobs, err := store.JobsOfCompany(ctx, s.db, company)
	if err != nil {
		return 0, err
	}
	now := model.Now()
	var closed []model.Job
	for i := range jobs {
		if jobs[i].Status == model.Active {
			jobs[i].Close(now)
			closed = append(closed, jobs[i])
		}
	}
	if err := store.SaveJobs(ctx, s.db, nil, closed); err != nil {
		return 0, err
	}
	// Recorded like a sync that found these jobs, all closed, with no fingerprint.
	return len(closed), store.MarkCompanySynced(ctx, s.db, company.Slug, now, "", jobs)
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
