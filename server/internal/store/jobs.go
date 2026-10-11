package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// Every query that loads jobs joins in their company: almost every caller
// needs its name, slug or domain.
const jobColumns = `j.id, j.external_id, j.title, j.location, j.work_mode, j.opportunity_type, j.role_family,
	j.level, j.experience_min, j.experience_max, j.url, j.posted_at, j.status, j.discovered_in_initial_sync,
	j.first_seen_at, j.updated_at, ` + companyColumns

const jobsWithCompany = ` from jobs j join companies c on c.id = j.company_id `

func jobFields(j *model.Job) []any {
	fields := []any{&j.ID, &j.ExternalID, &j.Title, &j.Location, &j.WorkMode, &j.OpportunityType, &j.RoleFamily,
		&j.Level, &j.ExperienceMin, &j.ExperienceMax, &j.URL, &j.PostedAt, &j.Status, &j.DiscoveredInInitialSync,
		&j.FirstSeenAt, &j.UpdatedAt}
	return append(fields, companyFields(&j.Company)...)
}

func scanJob(row pgx.CollectableRow) (model.Job, error) {
	var j model.Job
	err := row.Scan(jobFields(&j)...)
	return j, err
}

func JobByID(ctx context.Context, db DB, id string) (*model.Job, error) {
	rows, _ := db.Query(ctx, `select `+jobColumns+jobsWithCompany+`where j.id = $1`, id)
	return one(rows, scanJob)
}

func JobByExternalID(ctx context.Context, db DB, companyID, externalID string) (*model.Job, error) {
	rows, _ := db.Query(ctx, `select `+jobColumns+jobsWithCompany+`where j.company_id = $1 and j.external_id = $2`,
		companyID, externalID)
	return one(rows, scanJob)
}

// JobsOfCompany returns all of a company's jobs, open and closed.
func JobsOfCompany(ctx context.Context, db DB, companyID string) ([]model.Job, error) {
	rows, _ := db.Query(ctx, `select `+jobColumns+jobsWithCompany+`where j.company_id = $1`, companyID)
	return pgx.CollectRows(rows, scanJob)
}

// OpenJobsOfCompany returns a company's open jobs, newest first.
func OpenJobsOfCompany(ctx context.Context, db DB, companyID string) ([]model.Job, error) {
	rows, _ := db.Query(ctx, `select `+jobColumns+jobsWithCompany+`where j.company_id = $1 and j.status = 'ACTIVE'
		order by j.first_seen_at desc`, companyID)
	return pgx.CollectRows(rows, scanJob)
}

// OpenJobsAt returns the open jobs at any of the companies.
func OpenJobsAt(ctx context.Context, db DB, companyIDs []string) ([]model.Job, error) {
	rows, _ := db.Query(ctx, `select `+jobColumns+jobsWithCompany+`where j.company_id = any($1) and j.status = 'ACTIVE'`,
		companyIDs)
	return pgx.CollectRows(rows, scanJob)
}

func JobsByID(ctx context.Context, db DB, ids []string) ([]model.Job, error) {
	rows, _ := db.Query(ctx, `select `+jobColumns+jobsWithCompany+`where j.id = any($1)`, ids)
	return pgx.CollectRows(rows, scanJob)
}

// RoleFamilies are the role names on open jobs right now: the choices in
// the website's role dropdown.
func RoleFamilies(ctx context.Context, db DB) ([]string, error) {
	rows, _ := db.Query(ctx, `select distinct role_family from jobs
		where status = 'ACTIVE' and role_family is not null order by role_family`)
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// IsOpenRoleFamily reports whether an open job has that role family.
func IsOpenRoleFamily(ctx context.Context, db DB, roleFamily string) (bool, error) {
	return exists(ctx, db, `select exists (select 1 from jobs where role_family = $1 and status = 'ACTIVE')`, roleFamily)
}

// OpenJobCounts maps a company id to its number of open jobs.
func OpenJobCounts(ctx context.Context, db DB) (map[string]int, error) {
	rows, _ := db.Query(ctx, `select company_id, count(*) from jobs where status = 'ACTIVE' group by company_id`)
	counts := map[string]int{}
	var companyID string
	var n int
	_, err := pgx.ForEachRow(rows, []any{&companyID, &n}, func() error {
		counts[companyID] = n
		return nil
	})
	return counts, err
}

func CountOpenJobs(ctx context.Context, db DB) (int, error) {
	return count(ctx, db, `select count(*) from jobs where status = 'ACTIVE'`)
}

func InsertJob(ctx context.Context, db DB, j model.Job) error {
	_, err := db.Exec(ctx, insertJob, insertJobArgs(j)...)
	return err
}

// UpdateJob saves what Job.Update or Job.Close changed.
func UpdateJob(ctx context.Context, db DB, j model.Job) error {
	_, err := db.Exec(ctx, updateJob, updateJobArgs(j)...)
	return err
}

// SaveJobs inserts the new jobs and saves the changed ones in a single
// round trip to the database (a pgx batch) rather than one per job. That
// matters for a company's first sync, which is up to thousands of rows,
// against a database in another data centre (Neon).
func SaveJobs(ctx context.Context, db DB, inserted, changed []model.Job) error {
	if len(inserted)+len(changed) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, j := range inserted {
		batch.Queue(insertJob, insertJobArgs(j)...)
	}
	for _, j := range changed {
		batch.Queue(updateJob, updateJobArgs(j)...)
	}
	return db.SendBatch(ctx, batch).Close() // the first error, if any statement failed
}

const insertJob = `
	insert into jobs (id, company_id, external_id, title, location, work_mode, opportunity_type, role_family,
		level, experience_min, experience_max, url, posted_at, status, discovered_in_initial_sync, first_seen_at, updated_at)
	values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`

func insertJobArgs(j model.Job) []any {
	return []any{j.ID, j.Company.ID, j.ExternalID, j.Title, j.Location, j.WorkMode, j.OpportunityType, j.RoleFamily,
		j.Level, j.ExperienceMin, j.ExperienceMax, j.URL, j.PostedAt, j.Status, j.DiscoveredInInitialSync,
		j.FirstSeenAt, j.UpdatedAt}
}

const updateJob = `
	update jobs set title = $2, location = $3, work_mode = $4, opportunity_type = $5, role_family = $6,
		level = $7, experience_min = $8, experience_max = $9, url = $10, posted_at = $11, status = $12,
		updated_at = $13
	where id = $1`

func updateJobArgs(j model.Job) []any {
	return []any{j.ID, j.Title, j.Location, j.WorkMode, j.OpportunityType, j.RoleFamily, j.Level, j.ExperienceMin,
		j.ExperienceMax, j.URL, j.PostedAt, j.Status, j.UpdatedAt}
}
