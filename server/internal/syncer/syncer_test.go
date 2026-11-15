package syncer

import (
	"context"
	"testing"
	"time"

	"jobdrop/internal/boards"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
	"jobdrop/internal/testdb"
)

// These use TEST companies, whose "board" is their published test jobs, so
// the real sync runs end to end without the network.

func TestMain(m *testing.M) {
	testdb.Run(m)
}

func newSyncer() *Syncer {
	return New(testdb.DB, boards.All(nil, testdb.DB), nil)
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
	jobs, err := store.JobsOfCompany(context.Background(), testdb.DB, company)
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
	job := jobsOf(t, company)[0]
	for _, user := range []model.User{backendFan, designFan, noPreferences} {
		n, err := store.NotificationOf(context.Background(), testdb.DB, user.ID, job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if queued := n != nil && n.Status == model.Queued; queued != (user.ID == backendFan.ID) {
			t.Errorf("%s: queued %v", user.Email, queued)
		}
	}
}

func TestJobsTakenOffTheBoardCloseButAnEmptyAnswerClosesNothing(t *testing.T) {
	s := newSyncer()
	company := testdb.WatchableCompany(t)
	stays := testdb.PublishedTestJob(t, company, "Backend Engineer")
	goes := testdb.PublishedTestJob(t, company, "Data Engineer")
	syncNow(t, s, company)

	testdb.Unpublish(t, goes)
	if result := syncNow(t, s, company); result.Closed != 1 {
		t.Errorf("got %+v, want 1 closed", result)
	}

	testdb.Unpublish(t, stays) // the board is now empty
	if result := syncNow(t, s, company); result.Closed != 0 {
		t.Errorf("an empty board closed %d jobs", result.Closed)
	}
	job, err := store.JobByExternalID(context.Background(), testdb.DB, company.Slug, stays.ID)
	if err != nil || job == nil || job.Status != model.Active {
		t.Errorf("the job should still be open: %+v, %v", job, err)
	}
	if saved := companyNow(t, company); saved.EmptySince == nil {
		t.Error("the board's empty time should have started")
	}
}

// A board that stays empty for emptyFor is believed: its jobs close. When
// they come back on the board, they reopen, even if the board answers just
// as it did before it emptied (so "not modified" mustn't be trusted then).
func TestABoardThatStaysEmptyHasItsJobsClosedUntilTheyComeBack(t *testing.T) {
	ctx := context.Background()
	posting := model.Posting{ExternalID: "1", Title: "Backend Engineer", URL: "https://example.com/1",
		Classification: model.Classification{OpportunityType: model.FullTime}}
	board := &fakeBoard{etag: `W/"v1"`, postings: []model.Posting{posting}}
	s, company := withFakeBoard(t, board)
	syncNow(t, s, company)

	board.postings, board.etag = nil, `W/"v2"` // the board empties out...
	// ...and has been empty for longer than emptyFor already.
	if err := store.MarkBoardEmpty(ctx, testdb.DB, company.Slug, model.Now().Add(-emptyFor-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if result := syncNow(t, s, company); result.Closed != 1 {
		t.Fatalf("got %+v, want 1 closed", result)
	}

	board.postings, board.etag = []model.Posting{posting}, `W/"v1"` // back as it was
	if result := syncNow(t, s, company); result.Reopened != 1 {
		t.Errorf("got %+v, want 1 reopened", result)
	}
	if saved := companyNow(t, company); saved.EmptySince != nil {
		t.Error("a board that lists jobs again shouldn't count as empty")
	}
}

// A board that says it doesn't exist (404) is an empty board, not a failed
// sync: its empty time starts, and its jobs stay open for now.
func TestABoardThatIsGoneCountsAsEmpty(t *testing.T) {
	board := &fakeBoard{postings: []model.Posting{{ExternalID: "1", Title: "Backend Engineer",
		URL: "https://example.com/1", Classification: model.Classification{OpportunityType: model.FullTime}}}}
	s, company := withFakeBoard(t, board)
	syncNow(t, s, company)

	board.gone = true
	if result := syncNow(t, s, company); result.Closed != 0 {
		t.Errorf("got %+v, want nothing closed yet", result)
	}
	if saved := companyNow(t, company); saved.EmptySince == nil {
		t.Error("the board's empty time should have started")
	}
}

// A company switched off (dropped from companies.json, or by an admin) is
// no longer followed: the next round closes its jobs and drops its role
// families, and a sync of it saves nothing, whatever its board says.
func TestASwitchedOffCompanysJobsCloseInTheNextRound(t *testing.T) {
	ctx := context.Background()
	// Only the TEST board: the round also reaches the other tests'
	// companies, and the real boards would need the network.
	s := New(testdb.DB, map[model.Platform]boards.Board{model.PlatformTest: boards.All(nil, testdb.DB)[model.PlatformTest]}, nil)
	company := testdb.WatchableCompany(t)
	role := testdb.Unique("Platform Engineer")
	testdb.PublishedTestJob(t, company, role)
	syncNow(t, s, company)
	if err := store.SetCompanyActive(ctx, testdb.DB, company.Slug, false); err != nil {
		t.Fatal(err)
	}

	if err := s.SyncAll(ctx); err != nil {
		t.Fatal(err)
	}
	if job := jobsOf(t, company)[0]; job.Status != model.Closed {
		t.Errorf("the job is %s, want CLOSED", job.Status)
	}
	if open, err := store.IsOpenRoleFamily(ctx, testdb.DB, role); err != nil || open {
		t.Errorf("its role family should be gone from the choices (open %v, %v)", open, err)
	}
	if saved := companyNow(t, company); saved.OpenJobs != 0 {
		t.Errorf("%d open jobs counted, want 0", saved.OpenJobs)
	}
	if result := syncNow(t, s, company); result.Created+result.Reopened != 0 || jobsOf(t, company)[0].Status != model.Closed {
		t.Errorf("a sync of a switched-off company saved %+v", result)
	}
}

// withFakeBoard is a syncer whose Greenhouse is the given board, and a new
// Greenhouse company to sync with it.
func withFakeBoard(t *testing.T, board *fakeBoard) (*Syncer, model.Company) {
	t.Helper()
	s := New(testdb.DB, map[model.Platform]boards.Board{model.PlatformGreenhouse: board}, nil)
	company := model.Company{Slug: testdb.Unique("board-co"), Name: "Board Co", Platform: model.PlatformGreenhouse,
		BoardID: "board-co", Active: true, CreatedAt: model.Now()}
	if _, err := store.CreateCompany(context.Background(), testdb.DB, company); err != nil {
		t.Fatal(err)
	}
	return s, company
}

// companyNow is the company as now saved.
func companyNow(t *testing.T, company model.Company) model.Company {
	t.Helper()
	saved, err := store.CompanyBySlug(context.Background(), testdb.DB, company.Slug)
	if err != nil || saved == nil {
		t.Fatalf("no company %s: %v", company.Slug, err)
	}
	return *saved
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
	s := New(testdb.DB, boards.All(nil, testdb.DB), func() { woken++ })
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
// modified" when asked with that tag, or that there's no such board when
// it's gone, and records the tags it was asked with.
type fakeBoard struct {
	postings  []model.Posting
	etag      string
	gone      bool
	askedWith []string
}

func (f *fakeBoard) Fetch(_ context.Context, _ model.Company, etag string) ([]model.Posting, string, error) {
	f.askedWith = append(f.askedWith, etag)
	switch {
	case f.gone:
		return nil, "", boards.ErrNoBoard
	case etag != "" && etag == f.etag:
		return nil, "", boards.ErrNotModified
	}
	return f.postings, f.etag, nil
}

func TestABoardThatHasNotChangedIsOnlyMarkedAsChecked(t *testing.T) {
	board := &fakeBoard{etag: `W/"v1"`, postings: []model.Posting{{ExternalID: "1", Title: "Backend Engineer",
		URL: "https://example.com/1", Classification: model.Classification{OpportunityType: model.FullTime}}}}
	s, company := withFakeBoard(t, board)

	if first := syncNow(t, s, company); first.Created != 1 {
		t.Fatalf("first sync: got %+v", first)
	}
	firstChecked := lastSynced(t, company)
	time.Sleep(10 * time.Millisecond)
	second := syncNow(t, s, company)
	if !second.Unchanged || second.Created+second.Updated+second.Closed != 0 {
		t.Errorf("second sync: got %+v, want unchanged", second)
	}
	if board.askedWith[1] != `W/"v1"` {
		t.Errorf("the second read should send the saved tag, sent %q", board.askedWith[1])
	}
	if !lastSynced(t, company).After(firstChecked) {
		t.Error("an unchanged board should still be marked as checked again")
	}
}

// A board without an ETag that reads the same as last time is recognised
// by its fingerprint, and the jobs aren't even read.
func TestABoardThatReadsTheSameIsNotComparedAgain(t *testing.T) {
	s := newSyncer()
	company := testdb.WatchableCompany(t)
	testdb.PublishedTestJob(t, company, "Backend Engineer")
	syncNow(t, s, company)

	again := syncNow(t, s, company)
	if !again.Unchanged || again.Discovered != 1 {
		t.Errorf("got %+v, want 1 discovered, unchanged", again)
	}
	testdb.PublishedTestJob(t, company, "Data Engineer")
	if changed := syncNow(t, s, company); changed.Created != 1 {
		t.Errorf("a changed board: got %+v, want 1 created", changed)
	}
}

// A sync that stopped after saving a new job but before queueing its
// emails leaves the job's NotifyPending set; the next sync queues them,
// and only once.
func TestASyncThatStoppedHalfwayIsFinishedByTheNext(t *testing.T) {
	s := newSyncer()
	ctx := context.Background()
	company := testdb.WatchableCompany(t)
	fan := testdb.User(t, testdb.Unique("fan")+"@example.com")
	testdb.Watch(t, fan, company)
	testdb.WantsRole(t, fan, "Backend Engineer")
	testJob := testdb.PublishedTestJob(t, company, "Backend Engineer")
	// What the stopped sync saved: the new job, with no email queued yet.
	now := model.Now()
	roleFamily := "Backend Engineer"
	stopped := model.Job{ID: model.JobID(company.Slug, testJob.ID), ExternalID: testJob.ID, Title: "Backend Engineer",
		URL: testJob.ApplicationURL, Status: model.Active, OpportunityType: model.FullTime, RoleFamily: &roleFamily,
		FirstSeenAt: now, UpdatedAt: now, NotifyPending: true, Company: company}
	if err := store.InsertJob(ctx, testdb.DB, stopped); err != nil {
		t.Fatal(err)
	}

	if result := syncNow(t, s, company); result.Created != 0 || result.Queued != 1 {
		t.Errorf("the next sync: got %+v, want nothing created and 1 queued", result)
	}
	if job := jobsOf(t, company)[0]; job.NotifyPending {
		t.Error("the job should no longer be pending")
	}
	testdb.PublishedTestJob(t, company, "Product Designer") // a change, so the board is compared again
	if result := syncNow(t, s, company); result.Queued != 0 {
		t.Errorf("the one after: got %+v, want nothing queued", result)
	}
}

func lastSynced(t *testing.T, company model.Company) time.Time {
	t.Helper()
	saved := companyNow(t, company)
	if saved.LastSyncedAt == nil {
		t.Fatalf("no last sync time: %+v", saved)
	}
	return *saved.LastSyncedAt
}
