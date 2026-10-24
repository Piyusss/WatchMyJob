package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"sync"
	"time"

	"jobdrop/internal/model"
)

type jobItem struct {
	PK, SK string
	// Set only while the job is open: see keys.go.
	GSI2PK                  string                `dynamodbav:",omitempty"`
	GSI2SK                  string                `dynamodbav:",omitempty"`
	CompanySlug             string                `dynamodbav:"companySlug"`
	ExternalID              string                `dynamodbav:"externalId"`
	Title                   string                `dynamodbav:"title"`
	Location                *string               `dynamodbav:"location,omitempty"`
	WorkMode                *model.WorkMode       `dynamodbav:"workMode,omitempty"`
	OpportunityType         model.OpportunityType `dynamodbav:"opportunityType"`
	RoleFamily              *string               `dynamodbav:"roleFamily,omitempty"`
	Level                   *string               `dynamodbav:"level,omitempty"`
	ExperienceMin           *int                  `dynamodbav:"experienceMin,omitempty"`
	ExperienceMax           *int                  `dynamodbav:"experienceMax,omitempty"`
	URL                     string                `dynamodbav:"url"`
	PostedAt                *time.Time            `dynamodbav:"postedAt,omitempty"`
	Status                  model.JobStatus       `dynamodbav:"status"`
	DiscoveredInInitialSync bool                  `dynamodbav:"discoveredInInitialSync"`
	FirstSeenAt             time.Time             `dynamodbav:"firstSeenAt"`
	UpdatedAt               time.Time             `dynamodbav:"updatedAt"`
	NotifyPending           bool                  `dynamodbav:"notifyPending,omitempty"`
}

func jobItemOf(j model.Job) jobItem {
	slug := j.Company.Slug
	k := jobKey(slug, j.ExternalID)
	item := jobItem{PK: k.PK, SK: k.SK, CompanySlug: slug, ExternalID: j.ExternalID, Title: j.Title,
		Location: j.Location, WorkMode: j.WorkMode, OpportunityType: j.OpportunityType, RoleFamily: j.RoleFamily,
		Level: j.Level, ExperienceMin: j.ExperienceMin, ExperienceMax: j.ExperienceMax, URL: j.URL,
		PostedAt: j.PostedAt, Status: j.Status, DiscoveredInInitialSync: j.DiscoveredInInitialSync,
		FirstSeenAt: j.FirstSeenAt, UpdatedAt: j.UpdatedAt, NotifyPending: j.NotifyPending}
	if j.Status == model.Active {
		item.GSI2PK = "OPEN#" + slug
		item.GSI2SK = sortTime(j.FirstSeenAt) + "#" + j.ExternalID
	}
	return item
}

func (i jobItem) job(company model.Company) model.Job {
	return model.Job{ID: model.JobID(i.CompanySlug, i.ExternalID), ExternalID: i.ExternalID, Title: i.Title,
		Location: i.Location, WorkMode: i.WorkMode, OpportunityType: i.OpportunityType, RoleFamily: i.RoleFamily,
		Level: i.Level, ExperienceMin: i.ExperienceMin, ExperienceMax: i.ExperienceMax, URL: i.URL,
		PostedAt: i.PostedAt, Status: i.Status, DiscoveredInInitialSync: i.DiscoveredInInitialSync,
		FirstSeenAt: i.FirstSeenAt, UpdatedAt: i.UpdatedAt, NotifyPending: i.NotifyPending, Company: company}
}

// JobByID finds a job by its id, or returns nil (also for an id that
// isn't one).
func JobByID(ctx context.Context, d *DB, id string) (*model.Job, error) {
	slug, externalID, ok := model.ParseJobID(id)
	if !ok {
		return nil, nil
	}
	return JobByExternalID(ctx, d, slug, externalID)
}

func JobByExternalID(ctx context.Context, d *DB, companySlug, externalID string) (*model.Job, error) {
	var item jobItem
	found, err := d.get(ctx, jobKey(companySlug, externalID), &item)
	if !found || err != nil {
		return nil, err
	}
	company, err := CompanyBySlug(ctx, d, companySlug)
	if company == nil || err != nil {
		return nil, err
	}
	job := item.job(*company)
	return &job, nil
}

// JobsOfCompany returns all of a company's jobs, open and closed.
func JobsOfCompany(ctx context.Context, d *DB, company model.Company) ([]model.Job, error) {
	items, err := query[jobItem](ctx, d, inPartition(companyPartition(company.Slug), "JOB#"))
	if err != nil {
		return nil, err
	}
	jobs := make([]model.Job, len(items))
	for i, item := range items {
		jobs[i] = item.job(company)
	}
	return jobs, nil
}

// OpenJobsOfCompany returns a company's open jobs, newest first.
func OpenJobsOfCompany(ctx context.Context, d *DB, company model.Company) ([]model.Job, error) {
	jobs, err := openJobsOf(ctx, d, company)
	slices.SortFunc(jobs, func(a, b model.Job) int {
		return cmp.Or(b.FirstSeenAt.Compare(a.FirstSeenAt), strings.Compare(a.ID, b.ID))
	})
	return jobs, err
}

// OpenJobsAt returns the open jobs at any of the companies, in no particular order.
func OpenJobsAt(ctx context.Context, d *DB, companies []model.Company) ([]model.Job, error) {
	var mu sync.Mutex
	all := []model.Job{}
	err := inParallel(ctx, companies, 8, func(ctx context.Context, company model.Company) error {
		jobs, err := openJobsOf(ctx, d, company)
		mu.Lock()
		defer mu.Unlock()
		all = append(all, jobs...)
		return err
	})
	return all, err
}

// openJobsOf returns the company's open jobs, from the cache when it has
// them, otherwise from GSI2, which holds just the open ones.
func openJobsOf(ctx context.Context, d *DB, company model.Company) ([]model.Job, error) {
	items, version, cached := d.open.get(company.Slug)
	if !cached {
		var err error
		if items, err = query[jobItem](ctx, d, inIndex(gsi2, "OPEN#"+company.Slug)); err != nil {
			return nil, err
		}
		d.open.fill(company.Slug, items, version)
	}
	jobs := make([]model.Job, len(items))
	for i, item := range items {
		jobs[i] = item.job(company)
	}
	return jobs, nil
}

// JobsByID returns the jobs with those ids that exist, in no particular order.
func JobsByID(ctx context.Context, d *DB, ids []string) ([]model.Job, error) {
	var keys []key
	for _, id := range ids {
		if slug, externalID, ok := model.ParseJobID(id); ok {
			keys = append(keys, jobKey(slug, externalID))
		}
	}
	items, err := batchGet[jobItem](ctx, d, keys)
	if err != nil {
		return nil, err
	}
	return withCompanies(ctx, d, items)
}

// withCompanies turns job items into jobs, with their companies.
func withCompanies(ctx context.Context, d *DB, items []jobItem) ([]model.Job, error) {
	slugs := make([]string, len(items))
	for i, item := range items {
		slugs[i] = item.CompanySlug
	}
	companies, err := companiesBySlug(ctx, d, slugs)
	if err != nil {
		return nil, err
	}
	jobs := []model.Job{}
	for _, item := range items {
		if company, ok := companies[item.CompanySlug]; ok {
			jobs = append(jobs, item.job(company))
		}
	}
	return jobs, nil
}

// InsertJob adds a job, and fails if there's one with its id already.
func InsertJob(ctx context.Context, d *DB, j model.Job) error {
	defer d.open.forget(j.Company.Slug)
	return d.put(ctx, jobItemOf(j), "attribute_not_exists(PK)")
}

// UpdateJob saves what Job.Update or Job.Close changed.
func UpdateJob(ctx context.Context, d *DB, j model.Job) error {
	defer d.open.forget(j.Company.Slug)
	return d.put(ctx, jobItemOf(j), "attribute_exists(PK)")
}

// SaveJobs writes the sync's new jobs and changed ones, eight at a time.
// A new job is only written if its id is still free, a changed one only if
// it exists: if two syncs of a company ever run at once (two servers
// overlap for a moment during a deploy), one fails rather than both
// writing the same new job. A failed write stops the rest: the next sync
// finds what was saved and does the remainder.
func SaveJobs(ctx context.Context, d *DB, inserted, changed []model.Job) error {
	if len(inserted)+len(changed) == 0 {
		return nil
	}
	type write struct {
		job       model.Job
		condition string
	}
	var writes []write
	for _, j := range inserted {
		writes = append(writes, write{j, "attribute_not_exists(PK)"})
	}
	for _, j := range changed {
		writes = append(writes, write{j, "attribute_exists(PK)"})
	}
	defer d.open.forget(writes[0].job.Company.Slug)
	return inParallel(ctx, writes, 8, func(ctx context.Context, w write) error {
		return d.put(ctx, jobItemOf(w.job), w.condition)
	})
}

// ClearNotifyPending records that a new job's emails have all been queued.
func ClearNotifyPending(ctx context.Context, d *DB, j model.Job) error {
	return d.update(ctx, jobKey(j.Company.Slug, j.ExternalID), "REMOVE #notifyPending", nil)
}
