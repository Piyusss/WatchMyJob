package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// Test jobs: the fake openings an admin writes for a TEST company, each
// with its locations in test_job_locations.

const testJobColumns = `t.id, t.company_id, t.title, t.role_family, t.level, t.work_mode, t.opportunity_type,
	t.experience_min, t.experience_max, t.description, t.application_url, t.published_at, t.created_at`

func scanTestJob(row pgx.CollectableRow) (model.TestJob, error) {
	var t model.TestJob
	err := row.Scan(&t.ID, &t.CompanyID, &t.Title, &t.RoleFamily, &t.Level, &t.WorkMode, &t.OpportunityType,
		&t.ExperienceMin, &t.ExperienceMax, &t.Description, &t.ApplicationURL, &t.PublishedAt, &t.CreatedAt)
	return t, err
}

func TestJobByID(ctx context.Context, db DB, id string) (*model.TestJob, error) {
	rows, _ := db.Query(ctx, `select `+testJobColumns+` from test_jobs t where t.id = $1`, id)
	job, err := one(rows, scanTestJob)
	if job == nil || err != nil {
		return job, err
	}
	jobs, err := withLocations(ctx, db, []model.TestJob{*job})
	if err != nil {
		return nil, err
	}
	return &jobs[0], nil
}

// TestJobsOfCompany returns a test company's jobs, newest first.
func TestJobsOfCompany(ctx context.Context, db DB, companyID string) ([]model.TestJob, error) {
	rows, _ := db.Query(ctx, `select `+testJobColumns+` from test_jobs t where t.company_id = $1
		order by t.created_at desc`, companyID)
	jobs, err := pgx.CollectRows(rows, scanTestJob)
	if err != nil {
		return nil, err
	}
	return withLocations(ctx, db, jobs)
}

// PublishedTestJobs are a test company's "board": the jobs an admin published.
func PublishedTestJobs(ctx context.Context, db DB, companyID string) ([]model.TestJob, error) {
	rows, _ := db.Query(ctx, `select `+testJobColumns+` from test_jobs t where t.company_id = $1
		and t.published_at is not null`, companyID)
	jobs, err := pgx.CollectRows(rows, scanTestJob)
	if err != nil {
		return nil, err
	}
	return withLocations(ctx, db, jobs)
}

func CountTestJobs(ctx context.Context, db DB, companyID string) (int, error) {
	return count(ctx, db, `select count(*) from test_jobs where company_id = $1`, companyID)
}

// withLocations fills in each job's locations, with one query for all of them.
func withLocations(ctx context.Context, db DB, jobs []model.TestJob) ([]model.TestJob, error) {
	ids := make([]string, len(jobs))
	for i, job := range jobs {
		ids[i] = job.ID
		jobs[i].Locations = []model.Location{}
	}
	type jobLocation struct {
		jobID    string
		location model.Location
	}
	rows, _ := db.Query(ctx, `select test_job_id, `+locationColumns+` from test_job_locations
		where test_job_id = any($1)`, ids)
	found, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (jobLocation, error) {
		var jl jobLocation
		l := &jl.location
		err := row.Scan(&jl.jobID, &l.CountryCode, &l.CountryName, &l.StateCode, &l.StateName, &l.CityName)
		return jl, err
	})
	if err != nil {
		return nil, err
	}
	for _, jl := range found {
		for i := range jobs {
			if jobs[i].ID == jl.jobID {
				jobs[i].Locations = append(jobs[i].Locations, jl.location)
			}
		}
	}
	return jobs, nil
}

// SaveTestJob writes the job and replaces its locations, in one transaction.
func SaveTestJob(ctx context.Context, db DB, t model.TestJob) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			insert into test_jobs (id, company_id, title, role_family, level, work_mode, opportunity_type,
				experience_min, experience_max, description, application_url, published_at, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			on conflict (id) do update set title = excluded.title, role_family = excluded.role_family,
				level = excluded.level, work_mode = excluded.work_mode, opportunity_type = excluded.opportunity_type,
				experience_min = excluded.experience_min, experience_max = excluded.experience_max,
				description = excluded.description, application_url = excluded.application_url`,
			t.ID, t.CompanyID, t.Title, t.RoleFamily, t.Level, t.WorkMode, t.OpportunityType, t.ExperienceMin,
			t.ExperienceMax, t.Description, t.ApplicationURL, t.PublishedAt, t.CreatedAt)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from test_job_locations where test_job_id = $1`, t.ID); err != nil {
			return err
		}
		for _, l := range t.Locations {
			if _, err := tx.Exec(ctx, `insert into test_job_locations (test_job_id, `+locationColumns+`)
				values ($1, $2, $3, $4, $5, $6)`, t.ID, l.CountryCode, l.CountryName, l.StateCode, l.StateName,
				l.CityName); err != nil {
				return err
			}
		}
		return nil
	})
}

// PublishTestJob puts the job on its company's board. Publishing again
// keeps the first date.
func PublishTestJob(ctx context.Context, db DB, id string, now time.Time) error {
	_, err := db.Exec(ctx, `update test_jobs set published_at = coalesce(published_at, $2) where id = $1`, id, now)
	return err
}
