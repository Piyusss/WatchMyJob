// Package testdb is for the integration tests: DynamoDB Local in Docker, a
// throwaway database with the app's table, so the tests can never touch a
// real one; and helpers that add the items a test needs. Every helper makes
// uniquely named data, so tests never depend on each other.
package testdb

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/dynamodb"

	"jobdrop/internal/db"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// Run starts DynamoDB Local, runs a package's tests against it, then
// removes it. Call it from the package's TestMain; DB is ready when tests start.
func Run(m *testing.M) {
	ctx := context.Background()
	container, err := dynamodb.Run(ctx, "amazon/dynamodb-local:3.3.1",
		testcontainers.WithCmdArgs("-inMemory"), dynamodb.WithDisableTelemetry())
	if err != nil {
		fmt.Fprintln(os.Stderr, "starting DynamoDB Local in Docker (is Docker running?):", err)
		os.Exit(1)
	}
	err = connect(ctx, container)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		_ = testcontainers.TerminateContainer(container)
		os.Exit(1)
	}
	code := m.Run()
	_ = testcontainers.TerminateContainer(container)
	os.Exit(code)
}

func connect(ctx context.Context, container *dynamodb.DynamoDBContainer) error {
	address, err := container.ConnectionString(ctx)
	if err != nil {
		return err
	}
	client, err := db.Connect(ctx, "us-east-1", "http://"+address)
	if err != nil {
		return err
	}
	DB = store.New(client, "jobdrop")
	return DB.EnsureTable(ctx, false)
}

// DB is the test database.
var DB *store.DB

// Unique is prefix plus a random suffix.
func Unique(prefix string) string {
	return prefix + "-" + uuid.NewString()[:8]
}

// User adds a user with a verified email.
func User(t *testing.T, email string) model.User {
	t.Helper()
	user, err := store.CreateUser(context.Background(), DB, Unique("user"), "Test User", email, true)
	must(t, err)
	return user
}

// Company adds a test company. Until its first sync, it has no baseline.
func Company(t *testing.T, name string) model.Company {
	t.Helper()
	company := model.Company{Slug: Unique("test-co"), Name: name, Platform: model.PlatformTest, Active: true,
		CreatedAt: model.Now()}
	_, err := store.CreateCompany(context.Background(), DB, company)
	must(t, err)
	return company
}

// WatchableCompany adds a test company with its baseline done, so users can watch it.
func WatchableCompany(t *testing.T) model.Company {
	t.Helper()
	company := Company(t, "Test Co")
	must(t, store.MarkCompanySynced(context.Background(), DB, company.Slug, model.Now(), "", nil))
	company.InitialSyncDone = true
	return company
}

// OpenJob adds an open, full-time job in Bangalore whose role family is its
// title, and updates its company's counts as a sync would.
func OpenJob(t *testing.T, company model.Company, title string) model.Job {
	t.Helper()
	ctx := context.Background()
	now := model.Now()
	externalID := Unique("job")
	job := model.Job{ID: model.JobID(company.Slug, externalID), ExternalID: externalID, FirstSeenAt: now,
		UpdatedAt: now, Company: company}
	location := "Bangalore, India"
	job.Update(model.Posting{Title: title, Location: &location, URL: "https://example.com/job",
		Classification: model.Classification{RoleFamily: &title, OpportunityType: model.FullTime}}, now)
	must(t, store.InsertJob(ctx, DB, job))
	jobs, err := store.JobsOfCompany(ctx, DB, company)
	must(t, err)
	must(t, store.MarkCompanySynced(ctx, DB, company.Slug, now, "", jobs))
	return job
}

// PublishedTestJob adds a job to a test company's board.
func PublishedTestJob(t *testing.T, company model.Company, title string) model.TestJob {
	t.Helper()
	now := model.Now()
	testJob := model.TestJob{ID: uuid.NewString(), CompanySlug: company.Slug, Title: title, RoleFamily: title,
		OpportunityType: model.FullTime, ApplicationURL: "https://example.com/apply", PublishedAt: &now, CreatedAt: now,
		Locations: []model.Location{}}
	must(t, store.SaveTestJob(context.Background(), DB, testJob))
	return testJob
}

// Unpublish takes a test job off its company's board.
func Unpublish(t *testing.T, testJob model.TestJob) {
	t.Helper()
	testJob.PublishedAt = nil
	must(t, store.SaveTestJob(context.Background(), DB, testJob))
}

func Watch(t *testing.T, user model.User, company model.Company) {
	t.Helper()
	_, err := store.Watch(context.Background(), DB, user.ID, company.Slug)
	must(t, err)
}

// WantsRole gives the user preferences that only set a role; everything else is "any".
func WantsRole(t *testing.T, user model.User, roleFamily string) {
	t.Helper()
	prefs := &model.Preferences{ID: uuid.NewString(), UserID: user.ID}
	prefs.Update(model.Settings{RoleFamily: &roleFamily}, model.Now())
	must(t, store.SavePreferences(context.Background(), DB, prefs))
}

// EmptyQueue marks every queued email as skipped, so a test's sender
// round sends only what the test queues after.
func EmptyQueue(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	for {
		queued, err := store.QueuedNotifications(ctx, DB, 100)
		must(t, err)
		if len(queued) == 0 {
			return
		}
		for _, n := range queued {
			n.MarkSkipped("cleared by a test")
			must(t, store.SaveNotification(ctx, DB, n))
		}
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
