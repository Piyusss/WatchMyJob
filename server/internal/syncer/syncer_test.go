package syncer

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"jobdrop/internal/boards"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
	"jobdrop/internal/testdb"
)

// These use TEST companies, whose "board" is the test_jobs table, so the
// real sync runs end to end without the network.

func TestMain(m *testing.M) {
	testdb.Run(m)
}

func newSyncer() *Syncer {
	return New(testdb.Pool, boards.All(nil, testdb.Pool), nil)
}

func syncNow(t *testing.T, s *Syncer, company model.Company) Result {
	t.Helper()
	result, err := s.Sync(context.Background(), company)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func jobsOf(t *testing.T, company model.Company) []model.Job {
	t.Helper()
	jobs, err := store.JobsOfCompany(context.Background(), testdb.Pool, company.ID)
	if err != nil {
		t.Fatal(err)
	}
	return jobs
}

func TestTheFirstSyncIsABaselineAndOnlyLaterJobsAreEmailed(t *testing.T) {
	s := newSyncer()
	company := testdb.Company(t, "Fresh Co")
	fan := testdb.User(t, testdb.Unique("fan")+"@example.com")
	testdb.Watch(t, fan, company)
	testdb.WantsRole(t, fan, "Backend Engineer")
	testdb.PublishedTestJob(t, company, "Backend Engineer")

	baseline := syncNow(t, s, company)
	if baseline.Created != 1 || baseline.Queued != 0 {
		t.Errorf("baseline: got %+v", baseline)
	}
	if !jobsOf(t, company)[0].DiscoveredInInitialSync {
		t.Error("the baseline's job should be marked as part of it")
	}

	testdb.PublishedTestJob(t, company, "Backend Engineer")
	next := syncNow(t, s, company)
	if next.Created != 1 || next.Queued != 1 {
		t.Errorf("next sync: got %+v", next)
	}
}

func TestOnlyWatchersWhosePreferencesMatchAreEmailed(t *testing.T) {
	s := newSyncer()
	company := testdb.WatchableCompany(t)
	backendFan := testdb.User(t, testdb.Unique("backend")+"@example.com")
	designFan := testdb.User(t, testdb.Unique("design")+"@example.com")
	noPreferences := testdb.User(t, testdb.Unique("new")+"@example.com")
	for _, user := range []model.User{backendFan, designFan, noPreferences} {
		testdb.Watch(t, user, company)
	}
	testdb.WantsRole(t, backendFan, "Backend Engineer")
	testdb.WantsRole(t, designFan, "Product Designer")

	testdb.PublishedTestJob(t, company, "Backend Engineer")
	if result := syncNow(t, s, company); result.Queued != 1 {
		t.Fatalf("got %+v, want 1 queued", result)
	}
	var queuedFor []string
	err := testdb.Pool.QueryRow(context.Background(), `select array_agg(user_id::text) from notifications n
		join jobs j on j.id = n.job_id where j.company_id = $1 and n.status = 'QUEUED'`, company.ID).Scan(&queuedFor)
	if err != nil {
		t.Fatal(err)
	}
	if len(queuedFor) != 1 || queuedFor[0] != backendFan.ID {
		t.Errorf("queued for %v, want only %s", queuedFor, backendFan.ID)
	}
}

func TestJobsTakenOffTheBoardCloseButAnEmptyAnswerClosesNothing(t *testing.T) {
	s := newSyncer()
	company := testdb.WatchableCompany(t)
	stays := testdb.PublishedTestJob(t, company, "Backend Engineer")
	goes := testdb.PublishedTestJob(t, company, "Data Engineer")
	syncNow(t, s, company)

	unpublish(t, goes)
	if result := syncNow(t, s, company); result.Closed != 1 {
		t.Errorf("got %+v, want 1 closed", result)
	}

	unpublish(t, stays) // the board is now empty
	if result := syncNow(t, s, company); result.Closed != 0 {
		t.Errorf("an empty board closed %d jobs", result.Closed)
	}
	job, err := store.JobByExternalID(context.Background(), testdb.Pool, company.ID, stays.ID)
	if err != nil || job == nil || job.Status != model.Active {
		t.Errorf("the job should still be open: %+v, %v", job, err)
	}
}

func TestSyncingAgainWithNothingNewChangesNothing(t *testing.T) {
	s := newSyncer()
	company := testdb.WatchableCompany(t)
	testdb.PublishedTestJob(t, company, "Backend Engineer")
	syncNow(t, s, company)

	again := syncNow(t, s, company)
	if again.Discovered != 1 || again.Created+again.Updated+again.Closed+again.Queued != 0 {
		t.Errorf("got %+v", again)
	}
}

func TestTheSenderIsWokenWhenASyncQueuesEmails(t *testing.T) {
	woken := 0
	s := New(testdb.Pool, boards.All(nil, testdb.Pool), func() { woken++ })
	company := testdb.WatchableCompany(t)
	fan := testdb.User(t, testdb.Unique("fan")+"@example.com")
	testdb.Watch(t, fan, company)
	testdb.WantsRole(t, fan, "Backend Engineer")

	testdb.PublishedTestJob(t, company, "Product Designer") // matches nobody
	syncNow(t, s, company)
	testdb.PublishedTestJob(t, company, "Backend Engineer")
	syncNow(t, s, company)
	if woken != 1 {
		t.Errorf("woken %d times, want 1 (only by the sync that queued an email)", woken)
	}
}

// fakeBoard answers with the postings and tag the test gives it, or "not
// modified" when asked with that tag, and records the tags it was asked with.
type fakeBoard struct {
	postings  []model.Posting
	etag      string
	askedWith []string
}

func (f *fakeBoard) Fetch(_ context.Context, _ model.Company, etag string) ([]model.Posting, string, error) {
	f.askedWith = append(f.askedWith, etag)
	if etag != "" && etag == f.etag {
		return nil, "", boards.ErrNotModified
	}
	return f.postings, f.etag, nil
}

func TestABoardThatHasNotChangedIsOnlyMarkedAsChecked(t *testing.T) {
	board := &fakeBoard{etag: `W/"v1"`, postings: []model.Posting{{ExternalID: "1", Title: "Backend Engineer",
		URL: "https://example.com/1", Classification: model.Classification{OpportunityType: model.FullTime}}}}
	s := New(testdb.Pool, map[model.Platform]boards.Board{model.PlatformGreenhouse: board}, nil)
	company := model.Company{ID: uuid.NewString(), Slug: testdb.Unique("board-co"), Name: "Board Co",
		Platform: model.PlatformGreenhouse, BoardID: "board-co", Active: true, CreatedAt: model.Now()}
	if _, err := store.CreateCompany(context.Background(), testdb.Pool, company); err != nil {
		t.Fatal(err)
	}

	if first := syncNow(t, s, company); first.Created != 1 {
		t.Fatalf("first sync: got %+v", first)
	}
	_, err := testdb.Pool.Exec(context.Background(),
		`update companies set last_synced_at = now() - interval '1 hour' where id = $1`, company.ID)
	if err != nil {
		t.Fatal(err)
	}
	second := syncNow(t, s, company)
	if !second.Unchanged || second.Created+second.Updated+second.Closed != 0 {
		t.Errorf("second sync: got %+v, want unchanged", second)
	}
	if board.askedWith[1] != `W/"v1"` {
		t.Errorf("the second read should send the saved tag, sent %q", board.askedWith[1])
	}
	saved, err := store.CompanyByID(context.Background(), testdb.Pool, company.ID)
	if err != nil {
		t.Fatal(err)
	}
	if time.Since(*saved.LastSyncedAt) > time.Minute {
		t.Errorf("an unchanged board should still be marked as checked just now, got %v", saved.LastSyncedAt)
	}
}

func unpublish(t *testing.T, testJob model.TestJob) {
	t.Helper()
	if _, err := testdb.Pool.Exec(context.Background(), `delete from test_jobs where id = $1`, testJob.ID); err != nil {
		t.Fatal(err)
	}
}
