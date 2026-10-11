// Package testdb is for the integration tests: a real, throwaway PostgreSQL
// in Docker with the app's schema, so the tests can never touch a real
// database, and helpers that add the rows a test needs. Every helper makes
// uniquely named data, so tests never depend on each other.
package testdb

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"jobdrop/internal/db"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// Run starts the database, runs a package's tests against it, then removes
// it. Call it from the package's TestMain; Pool is ready when tests start.
func Run(m *testing.M) {
	ctx := context.Background()
	container, err := postgres.Run(ctx, "postgres:16-alpine", postgres.BasicWaitStrategies())
	if err != nil {
		fmt.Fprintln(os.Stderr, "starting PostgreSQL in Docker (is Docker running?):", err)
		os.Exit(1)
	}
	url, err := container.ConnectionString(ctx, "sslmode=disable")
	if err == nil {
		Pool, err = db.Connect(ctx, url, "", "")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		_ = testcontainers.TerminateContainer(container)
		os.Exit(1)
	}
	code := m.Run()
	Pool.Close()
	_ = testcontainers.TerminateContainer(container)
	os.Exit(code)
}

// Pool is the connection pool to the test database.
var Pool *pgxpool.Pool

// Unique is prefix plus a random suffix.
func Unique(prefix string) string {
	return prefix + "-" + uuid.NewString()[:8]
}

// User adds a user with a verified email.
func User(t *testing.T, email string) model.User {
	t.Helper()
	user, err := store.CreateUser(context.Background(), Pool, Unique("clerk"), "Test User", email, true)
	must(t, err)
	return user
}

// Company adds a test company. Until its first sync, it has no baseline.
func Company(t *testing.T, name string) model.Company {
	t.Helper()
	company := model.Company{ID: uuid.NewString(), Slug: Unique("test-co"), Name: name,
		Platform: model.PlatformTest, Active: true, CreatedAt: model.Now()}
	_, err := store.CreateCompany(context.Background(), Pool, company)
	must(t, err)
	return company
}

// WatchableCompany adds a test company with its baseline done, so users can watch it.
func WatchableCompany(t *testing.T) model.Company {
	t.Helper()
	company := Company(t, "Test Co")
	must(t, store.MarkCompanySynced(context.Background(), Pool, company.ID, model.Now()))
	company.InitialSyncDone = true
	return company
}

// OpenJob adds an open, full-time job in Bangalore whose role family is its title.
func OpenJob(t *testing.T, company model.Company, title string) model.Job {
	t.Helper()
	now := model.Now()
	job := model.Job{ID: uuid.NewString(), ExternalID: Unique("job"), FirstSeenAt: now, UpdatedAt: now, Company: company}
	location := "Bangalore, India"
	job.Update(model.Posting{Title: title, Location: &location, URL: "https://example.com/job",
		Classification: model.Classification{RoleFamily: &title, OpportunityType: model.FullTime}}, now)
	must(t, store.InsertJob(context.Background(), Pool, job))
	return job
}

// PublishedTestJob adds a job to a test company's board.
func PublishedTestJob(t *testing.T, company model.Company, title string) model.TestJob {
	t.Helper()
	now := model.Now()
	testJob := model.TestJob{ID: uuid.NewString(), CompanyID: company.ID, Title: title, RoleFamily: title,
		OpportunityType: model.FullTime, ApplicationURL: "https://example.com/apply", PublishedAt: &now, CreatedAt: now,
		Locations: []model.Location{}}
	must(t, store.SaveTestJob(context.Background(), Pool, testJob))
	return testJob
}

func Watch(t *testing.T, user model.User, company model.Company) {
	t.Helper()
	_, err := store.Watch(context.Background(), Pool, user.ID, company.ID)
	must(t, err)
}

// WantsRole gives the user preferences that only set a role; everything else is "any".
func WantsRole(t *testing.T, user model.User, roleFamily string) {
	t.Helper()
	prefs := &model.Preferences{ID: uuid.NewString(), UserID: user.ID}
	prefs.Update(model.Settings{RoleFamily: &roleFamily}, model.Now())
	must(t, store.SavePreferences(context.Background(), Pool, prefs))
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
