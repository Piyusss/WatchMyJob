package store

import (
	"context"
	"slices"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"jobdrop/internal/model"
)

// Test jobs: the fake openings an admin writes for a TEST company. They're
// kept in the company's partition, where its board (PublishedTestJobs) is
// one strongly consistent Query: publishing runs the sync straight away,
// and it must see the job just published. The admin pages know a test job
// only by its id, so a small pointer item leads from the id to the company.

type testJobItem struct {
	PK, SK          string
	ID              string                `dynamodbav:"id"`
	CompanySlug     string                `dynamodbav:"companySlug"`
	Title           string                `dynamodbav:"title"`
	RoleFamily      string                `dynamodbav:"roleFamily"`
	Level           *string               `dynamodbav:"level,omitempty"`
	WorkMode        *model.WorkMode       `dynamodbav:"workMode,omitempty"`
	OpportunityType model.OpportunityType `dynamodbav:"opportunityType"`
	ExperienceMin   *int                  `dynamodbav:"experienceMin,omitempty"`
	ExperienceMax   *int                  `dynamodbav:"experienceMax,omitempty"`
	Description     *string               `dynamodbav:"description,omitempty"`
	ApplicationURL  string                `dynamodbav:"applicationUrl"`
	PublishedAt     *time.Time            `dynamodbav:"publishedAt,omitempty"`
	CreatedAt       time.Time             `dynamodbav:"createdAt"`
	Locations       []locationItem        `dynamodbav:"locations"`
}

type testJobPointer struct {
	PK, SK      string
	CompanySlug string `dynamodbav:"companySlug"`
}

func testJobItemOf(t model.TestJob) testJobItem {
	k := testJobKey(t.CompanySlug, t.ID)
	return testJobItem{k.PK, k.SK, t.ID, t.CompanySlug, t.Title, t.RoleFamily, t.Level, t.WorkMode, t.OpportunityType,
		t.ExperienceMin, t.ExperienceMax, t.Description, t.ApplicationURL, t.PublishedAt, t.CreatedAt,
		locationItemsOf(t.Locations)}
}

func (i testJobItem) testJob() model.TestJob {
	return model.TestJob{ID: i.ID, CompanySlug: i.CompanySlug, Title: i.Title, RoleFamily: i.RoleFamily,
		Level: i.Level, WorkMode: i.WorkMode, OpportunityType: i.OpportunityType, ExperienceMin: i.ExperienceMin,
		ExperienceMax: i.ExperienceMax, Description: i.Description, ApplicationURL: i.ApplicationURL,
		PublishedAt: i.PublishedAt, CreatedAt: i.CreatedAt, Locations: locationsOf(i.Locations)}
}

// A location as stored, in a test job or in preferences.
type locationItem struct {
	CountryCode string  `dynamodbav:"countryCode"`
	CountryName string  `dynamodbav:"countryName"`
	StateCode   *string `dynamodbav:"stateCode,omitempty"`
	StateName   *string `dynamodbav:"stateName,omitempty"`
	CityName    *string `dynamodbav:"cityName,omitempty"`
}

func locationItemsOf(locations []model.Location) []locationItem {
	items := make([]locationItem, len(locations))
	for i, l := range locations {
		items[i] = locationItem(l)
	}
	return items
}

func locationsOf(items []locationItem) []model.Location {
	locations := make([]model.Location, len(items))
	for i, item := range items {
		locations[i] = model.Location(item)
	}
	return locations
}

func TestJobByID(ctx context.Context, d *DB, id string) (*model.TestJob, error) {
	var pointer testJobPointer
	found, err := d.get(ctx, testJobPointerKey(id), &pointer)
	if !found || err != nil {
		return nil, err
	}
	var item testJobItem
	found, err = d.get(ctx, testJobKey(pointer.CompanySlug, id), &item)
	if !found || err != nil {
		return nil, err
	}
	job := item.testJob()
	return &job, nil
}

// TestJobsOfCompany returns a test company's jobs, newest first.
func TestJobsOfCompany(ctx context.Context, d *DB, companySlug string) ([]model.TestJob, error) {
	items, err := query[testJobItem](ctx, d, inPartition(companyPartition(companySlug), "TESTJOB#"))
	if err != nil {
		return nil, err
	}
	jobs := make([]model.TestJob, len(items))
	for i, item := range items {
		jobs[i] = item.testJob()
	}
	slices.SortStableFunc(jobs, func(a, b model.TestJob) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return jobs, nil
}

// PublishedTestJobs are a test company's "board": the jobs an admin published.
func PublishedTestJobs(ctx context.Context, d *DB, companySlug string) ([]model.TestJob, error) {
	jobs, err := TestJobsOfCompany(ctx, d, companySlug)
	return slices.DeleteFunc(jobs, func(t model.TestJob) bool { return t.PublishedAt == nil }), err
}

func CountTestJobs(ctx context.Context, d *DB, companySlug string) (int, error) {
	return count(ctx, d, inPartition(companyPartition(companySlug), "TESTJOB#"))
}

// SaveTestJob writes the job and its pointer together, in a transaction:
// both are written or neither is.
func SaveTestJob(ctx context.Context, d *DB, t model.TestJob) error {
	k := testJobPointerKey(t.ID)
	pointer, err := attributevalue.MarshalMap(testJobPointer{k.PK, k.SK, t.CompanySlug})
	if err != nil {
		return err
	}
	item, err := attributevalue.MarshalMap(testJobItemOf(t))
	if err != nil {
		return err
	}
	_, err = d.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: &d.table, Item: pointer}},
			{Put: &types.Put{TableName: &d.table, Item: item}},
		},
	})
	return err
}

// PublishTestJob puts the job on its company's board. Publishing again
// keeps the first date.
func PublishTestJob(ctx context.Context, d *DB, t model.TestJob, now time.Time) error {
	return d.update(ctx, testJobKey(t.CompanySlug, t.ID), "SET #publishedAt = if_not_exists(#publishedAt, :now)",
		map[string]any{":now": now})
}
