package store_test

import (
	"context"
	"sync"
	"testing"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
	"jobdrop/internal/testdb"
)

// What the keys and conditional writes promise (see keys.go), checked
// against DynamoDB Local. Most of the store is tested through the API,
// sync and email tests.

func TestMain(m *testing.M) {
	testdb.Run(m)
}

var ctx = context.Background()

func check(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// The website sends a few requests at once right after sign-in; each may
// find no user yet, but only one user is created.
func TestFirstRequestsAtOnceCreateOneUser(t *testing.T) {
	id := testdb.Unique("user")
	users := make([]model.User, 8)
	var wg sync.WaitGroup
	for i := range users {
		wg.Go(func() {
			user, err := store.CreateUser(ctx, testdb.DB, id, "Ada", "ada@example.com", true)
			if err != nil {
				t.Error(err)
			}
			users[i] = user
		})
	}
	wg.Wait()
	for _, user := range users {
		if user.UnsubscribeToken != users[0].UnsubscribeToken {
			t.Fatalf("two different users were created: %+v and %+v", users[0], user)
		}
	}
}

func TestDeletingAUserLeavesNothingOfTheirs(t *testing.T) {
	user := testdb.User(t, testdb.Unique("leaving")+"@example.com")
	company := testdb.WatchableCompany(t)
	job := testdb.OpenJob(t, company, "Backend Engineer")
	testdb.Watch(t, user, company)
	testdb.WantsRole(t, user, "Backend Engineer")
	check(t, store.SetMark(ctx, testdb.DB, user.ID, job.ID, model.Saved))
	_, err := store.QueueNotification(ctx, testdb.DB, user.ID, job.ID)
	check(t, err)

	check(t, store.DeleteUser(ctx, testdb.DB, user.ID))

	found, err := store.UserByID(ctx, testdb.DB, user.ID)
	check(t, err)
	byToken, err := store.UserByUnsubscribeToken(ctx, testdb.DB, user.UnsubscribeToken)
	check(t, err)
	prefs, err := store.PreferencesOf(ctx, testdb.DB, user.ID)
	check(t, err)
	marks, err := store.MarksOf(ctx, testdb.DB, user.ID)
	check(t, err)
	notification, err := store.NotificationOf(ctx, testdb.DB, user.ID, job.ID)
	check(t, err)
	watchers, err := store.WatchersOf(ctx, testdb.DB, company.Slug)
	check(t, err)
	if found != nil || byToken != nil || prefs != nil || len(marks) != 0 || notification != nil || len(watchers) != 0 {
		t.Errorf("left behind: user %v, by token %v, preferences %v, marks %v, notification %v, watching %v",
			found, byToken, prefs, marks, notification, watchers)
	}
}

func TestAJobIsFoundByItsID(t *testing.T) {
	company := testdb.WatchableCompany(t)
	job := testdb.OpenJob(t, company, "Backend Engineer")

	found, err := store.JobByID(ctx, testdb.DB, job.ID)
	check(t, err)
	if found == nil || found.Title != "Backend Engineer" || found.Company.Slug != company.Slug {
		t.Errorf("JobByID(%q) = %+v", job.ID, found)
	}
	jobs, err := store.JobsByID(ctx, testdb.DB, []string{job.ID, "not-an-id", company.Slug + ".no-such-job", job.ID})
	check(t, err)
	if len(jobs) != 1 || jobs[0].ID != job.ID {
		t.Errorf("JobsByID found %+v, want only %s", jobs, job.ID)
	}
}

// A notification's key is the user and the job, so a second email about
// the same job can't be queued: this is what makes the sync safe to repeat.
func TestAnEmailAboutAJobIsQueuedOnlyOnce(t *testing.T) {
	user := testdb.User(t, testdb.Unique("once")+"@example.com")
	job := testdb.OpenJob(t, testdb.WatchableCompany(t), "Backend Engineer")
	for i, want := range []bool{true, false} {
		queued, err := store.QueueNotification(ctx, testdb.DB, user.ID, job.ID)
		check(t, err)
		if queued != want {
			t.Errorf("attempt %d: queued %v, want %v", i+1, queued, want)
		}
	}
}

// The website reads a missing list as an error: empty ones must come back as [].
func TestPreferencesKeepTheirEmptyLists(t *testing.T) {
	user := testdb.User(t, testdb.Unique("open-minded")+"@example.com")
	prefs := &model.Preferences{ID: "prefs", UserID: user.ID}
	prefs.Update(model.Settings{}, model.Now())
	check(t, store.SavePreferences(ctx, testdb.DB, prefs))

	saved, err := store.PreferencesOf(ctx, testdb.DB, user.ID)
	check(t, err)
	if saved.Locations == nil || saved.WorkModes == nil || saved.OpportunityTypes == nil {
		t.Errorf("a list came back nil: %+v", saved.Settings)
	}
}

// The role families are cached (cache.go); a sync's save shows at once.
func TestANewRoleFamilyCanBePickedAtOnce(t *testing.T) {
	role := testdb.Unique("Backend Engineer")
	open := func() bool {
		t.Helper()
		found, err := store.IsOpenRoleFamily(ctx, testdb.DB, role)
		check(t, err)
		return found
	}
	if open() { // also fills the cache
		t.Fatal("no job has the role yet")
	}
	testdb.OpenJob(t, testdb.WatchableCompany(t), role)
	if !open() {
		t.Error("the role of a job just saved should be open")
	}
}

// The cache of open jobs (cache.go) follows every write of a company's jobs.
func TestTheOpenJobsFollowTheWrites(t *testing.T) {
	company := testdb.WatchableCompany(t)
	job := testdb.OpenJob(t, company, "Backend Engineer")
	open := func() int {
		t.Helper()
		jobs, err := store.OpenJobsOfCompany(ctx, testdb.DB, company)
		check(t, err)
		return len(jobs)
	}
	if n := open(); n != 1 {
		t.Fatalf("%d open jobs, want 1", n)
	}

	job.Close(model.Now())
	check(t, store.UpdateJob(ctx, testdb.DB, job))
	if n := open(); n != 0 {
		t.Errorf("after closing it: %d open jobs, want 0", n)
	}

	reopened := job
	reopened.Status = model.Active
	check(t, store.MarkCompanySynced(ctx, testdb.DB, company.Slug, model.Now(), "", []model.Job{reopened}))
	if n := open(); n != 1 {
		t.Errorf("after a sync handed it over: %d open jobs, want 1", n)
	}
}
