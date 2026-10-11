package boards

import (
	"context"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// Test is the "job board" of an admin-made TEST company: its published test
// jobs. The admin typed the role, level and experience, so nothing is guessed.
// It's read from our own database, so it has no ETag and is always read in full.
type Test struct {
	db store.DB
}

func (t Test) Fetch(ctx context.Context, company model.Company, _ string) ([]model.Posting, string, error) {
	jobs, err := store.PublishedTestJobs(ctx, t.db, company.ID)
	if err != nil {
		return nil, "", err
	}
	postings := make([]model.Posting, len(jobs))
	for i, job := range jobs {
		roleFamily := job.RoleFamily
		postings[i] = model.Posting{
			ExternalID: job.ID,
			Title:      job.Title,
			Location:   job.LocationLabel(),
			WorkMode:   job.WorkMode,
			URL:        job.ApplicationURL,
			PostedAt:   job.PublishedAt,
			Classification: model.Classification{
				RoleFamily:      &roleFamily,
				Level:           job.Level,
				OpportunityType: job.OpportunityType,
				ExperienceMin:   job.ExperienceMin,
				ExperienceMax:   job.ExperienceMax,
			},
		}
	}
	return postings, "", nil
}
