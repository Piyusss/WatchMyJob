package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// The admin pages: make a fake (TEST) company, write openings for it and
// publish them. Publishing runs the real sync, so a matching user gets a
// real email: the whole flow, on demand.

type testCompanyItem struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Slug          string    `json:"slug"`
	Status        string    `json:"status"`
	Domain        *string   `json:"domain"`
	CreatedAt     time.Time `json:"createdAt"`
	OpenJobs      int       `json:"openJobs"`
	TotalTestJobs int       `json:"totalTestJobs"`
}

func (s *Server) testCompanyItem(ctx context.Context, c model.Company, openJobs int) (testCompanyItem, error) {
	total, err := store.CountTestJobs(ctx, s.db, c.ID)
	return testCompanyItem{c.ID, c.Name, c.Slug, c.Status(), c.Domain, c.CreatedAt, openJobs, total}, err
}

func (s *Server) listTestCompanies(w http.ResponseWriter, r *http.Request, _ model.User) error {
	companies, err := store.TestCompanies(r.Context(), s.db)
	if err != nil {
		return err
	}
	openJobs, err := store.OpenJobCounts(r.Context(), s.db)
	if err != nil {
		return err
	}
	items := make([]testCompanyItem, len(companies))
	for i, c := range companies {
		if items[i], err = s.testCompanyItem(r.Context(), c, openJobs[c.ID]); err != nil {
			return err
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"companies": items})
	return nil
}

func (s *Server) createTestCompany(w http.ResponseWriter, r *http.Request, _ model.User) error {
	var body struct {
		Name   *string `json:"name"`
		Slug   *string `json:"slug"`
		Domain *string `json:"domain"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.notBlank("name", body.Name)
	p.maxLength("name", body.Name, 120)
	p.maxLength("slug", body.Slug, 80)
	p.maxLength("domain", body.Domain, 255)
	if err := p.err(); err != nil {
		return err
	}

	slug := slugify(*body.Name)
	if trimmed(body.Slug) != nil {
		slug = slugify(*body.Slug)
	}
	if slug == "" {
		return invalidField("name", "Must contain at least one letter or number")
	}
	// Only the bare host is kept ("https://acme.com/about" becomes
	// "acme.com"): the website shows the company's logo from it.
	domain := trimmed(body.Domain)
	if domain != nil {
		host := urlScheme.ReplaceAllString(*domain, "")
		host = urlPath.ReplaceAllString(host, "")
		domain = &host
	}

	now := model.Now()
	company := model.Company{
		ID:       uuid.NewString(),
		Slug:     slug,
		Name:     strings.TrimSpace(*body.Name),
		Domain:   domain,
		Platform: model.PlatformTest,
		Active:   true,
		// A new test company has nothing published, so its (empty) baseline
		// is already done and users can watch it straight away.
		InitialSyncDone: true,
		LastSyncedAt:    &now,
		CreatedAt:       now,
	}
	created, err := store.CreateCompany(r.Context(), s.db, company)
	if err != nil {
		return err
	}
	if !created {
		return &apiError{status: http.StatusConflict, message: fmt.Sprintf("A company with slug %q already exists", slug)}
	}
	item, err := s.testCompanyItem(r.Context(), company, 0)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"company": item})
	return nil
}

var (
	nonAlphanumeric = regexp.MustCompile(`[^a-z0-9]+`)
	edgeDashes      = regexp.MustCompile(`^-+|-+$`)
	urlScheme       = regexp.MustCompile(`^https?://`)
	urlPath         = regexp.MustCompile(`/.*$`)
)

// slugify: "Acme Corp, Inc." becomes "acme-corp-inc".
func slugify(text string) string {
	slug := nonAlphanumeric.ReplaceAllString(strings.ToLower(strings.TrimSpace(text)), "-")
	return edgeDashes.ReplaceAllString(slug, "")
}

// setTestCompanyStatus switches a company on or off. Off also unwatches it
// for everyone.
func (s *Server) setTestCompanyStatus(w http.ResponseWriter, r *http.Request, _ model.User) error {
	var body struct {
		Status *string `json:"status"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.notNull("status", body.Status == nil)
	p.oneOf("status", body.Status, "ACTIVE", "INACTIVE")
	if err := p.err(); err != nil {
		return err
	}
	company, err := s.testCompany(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	company.Active = *body.Status == "ACTIVE"
	if err := store.SetCompanyActive(r.Context(), s.db, company.ID, company.Active); err != nil {
		return err
	}
	unwatched := 0
	if !company.Active {
		if unwatched, err = store.UnwatchAll(r.Context(), s.db, company.ID); err != nil {
			return err
		}
	}
	openJobs, err := store.OpenJobCounts(r.Context(), s.db)
	if err != nil {
		return err
	}
	item, err := s.testCompanyItem(r.Context(), *company, openJobs[company.ID])
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"company": item, "subscriptionsDeactivated": unwatched})
	return nil
}

// jobLink points from a test job to the real Job it became when published.
type jobLink struct {
	ID            string          `json:"id"`
	ExternalJobID string          `json:"externalJobId"`
	Status        model.JobStatus `json:"status"`
}

type testJobView struct {
	ID                    string                `json:"id"`
	Title                 string                `json:"title"`
	RoleFamily            string                `json:"roleFamily"`
	Level                 *string               `json:"level"`
	WorkMode              *model.WorkMode       `json:"workMode"`
	OpportunityType       model.OpportunityType `json:"opportunityType"`
	RequiredExperienceMin *int                  `json:"requiredExperienceMin"`
	RequiredExperienceMax *int                  `json:"requiredExperienceMax"`
	Description           *string               `json:"description"`
	ApplicationURL        string                `json:"applicationUrl"`
	Published             bool                  `json:"published"`
	PublishedAt           *time.Time            `json:"publishedAt"`
	Locations             []model.Location      `json:"locations"`
	Job                   *jobLink              `json:"job"`
}

// viewOfTestJob shows a test job, with the real Job it became (nil until published).
func viewOfTestJob(t model.TestJob, job *model.Job) testJobView {
	var link *jobLink
	if job != nil {
		link = &jobLink{job.ID, job.ExternalID, job.Status}
	}
	return testJobView{t.ID, t.Title, t.RoleFamily, t.Level, t.WorkMode, t.OpportunityType, t.ExperienceMin,
		t.ExperienceMax, t.Description, t.ApplicationURL, t.PublishedAt != nil, t.PublishedAt, t.Locations, link}
}

func (s *Server) testCompanyDetail(w http.ResponseWriter, r *http.Request, _ model.User) error {
	company, err := s.testCompany(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	jobs, err := store.JobsOfCompany(r.Context(), s.db, company.ID)
	if err != nil {
		return err
	}
	// A published test job's real Job carries the test job's id as its externalId.
	published := map[string]*model.Job{}
	for i := range jobs {
		published[jobs[i].ExternalID] = &jobs[i]
	}
	testJobs, err := store.TestJobsOfCompany(r.Context(), s.db, company.ID)
	if err != nil {
		return err
	}
	views := make([]testJobView, len(testJobs))
	for i, t := range testJobs {
		views[i] = viewOfTestJob(t, published[t.ID])
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"company": map[string]any{
			"id": company.ID, "name": company.Name, "slug": company.Slug, "status": company.Status(),
			"domain": company.Domain, "selectable": company.Selectable(),
		},
		"jobs": views,
	})
	return nil
}

// testJobInput is the admin's test job form.
type testJobInput struct {
	Title                 *string                `json:"title"`
	RoleFamily            *string                `json:"roleFamily"`
	Level                 *string                `json:"level"`
	Locations             []locationInput        `json:"locations"`
	WorkMode              *model.WorkMode        `json:"workMode"`
	OpportunityType       *model.OpportunityType `json:"opportunityType"`
	RequiredExperienceMin *int                   `json:"requiredExperienceMin"`
	RequiredExperienceMax *int                   `json:"requiredExperienceMax"`
	Description           *string                `json:"description"`
	ApplicationURL        *string                `json:"applicationUrl"`
}

func (in testJobInput) problems() error {
	p := problems{}
	p.notBlank("title", in.Title)
	p.maxLength("title", in.Title, 300)
	p.notBlank("roleFamily", in.RoleFamily)
	p.maxLength("roleFamily", in.RoleFamily, 200)
	p.oneOf("level", in.Level, levels...)
	p.locations(in.Locations)
	p.between("requiredExperienceMin", in.RequiredExperienceMin, 0, 60)
	p.between("requiredExperienceMax", in.RequiredExperienceMax, 0, 60)
	p.maxLength("description", in.Description, 20000)
	p.notBlank("applicationUrl", in.ApplicationURL)
	p.validURL("applicationUrl", in.ApplicationURL)
	return p.err()
}

// applyTestJob copies the form into the test job, after the same checks as
// the real thing: a role on a real open job, known places, and an
// experience range the right way round.
func (s *Server) applyTestJob(r *http.Request, t *model.TestJob, in testJobInput) error {
	roleFamily := strings.TrimSpace(*in.RoleFamily)
	if err := s.checkRoleFamily(r, &roleFamily); err != nil {
		return err
	}
	if in.RequiredExperienceMin != nil && in.RequiredExperienceMax != nil &&
		*in.RequiredExperienceMax < *in.RequiredExperienceMin {
		return invalidField("requiredExperienceMax", "Max experience must be greater than or equal to min")
	}
	locations, err := resolve(in.Locations)
	if err != nil {
		return err
	}
	t.Title = strings.TrimSpace(*in.Title)
	t.RoleFamily = roleFamily
	t.Level = in.Level
	t.WorkMode = in.WorkMode
	t.OpportunityType = model.FullTime
	if in.OpportunityType != nil {
		t.OpportunityType = *in.OpportunityType
	}
	t.ExperienceMin = in.RequiredExperienceMin
	t.ExperienceMax = in.RequiredExperienceMax
	t.Description = trimmed(in.Description)
	t.ApplicationURL = strings.TrimSpace(*in.ApplicationURL)
	t.Locations = locations
	return nil
}

// createTestJob: writing a test job never notifies anyone; only publishing does.
func (s *Server) createTestJob(w http.ResponseWriter, r *http.Request, _ model.User) error {
	var in testJobInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := in.problems(); err != nil {
		return err
	}
	company, err := s.testCompany(r.Context(), r.PathValue("slug"))
	if err != nil {
		return err
	}
	testJob := model.TestJob{ID: uuid.NewString(), CompanyID: company.ID, CreatedAt: model.Now()}
	if err := s.applyTestJob(r, &testJob, in); err != nil {
		return err
	}
	if err := store.SaveTestJob(r.Context(), s.db, testJob); err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, map[string]any{"job": viewOfTestJob(testJob, nil)})
	return nil
}

func (s *Server) updateTestJob(w http.ResponseWriter, r *http.Request, _ model.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	var in testJobInput
	if err := readJSON(w, r, &in); err != nil {
		return err
	}
	if err := in.problems(); err != nil {
		return err
	}
	testJob, err := store.TestJobByID(r.Context(), s.db, id)
	if err != nil {
		return err
	}
	if testJob == nil {
		return notFound("No such test job")
	}
	if err := s.applyTestJob(r, testJob, in); err != nil {
		return err
	}
	if err := store.SaveTestJob(r.Context(), s.db, *testJob); err != nil {
		return err
	}
	job, err := store.JobByExternalID(r.Context(), s.db, testJob.CompanyID, testJob.ID)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"job": viewOfTestJob(*testJob, job)})
	return nil
}

// publishResult has the field names the website reads, including some the
// sync doesn't track (missing, circuitBreakerTripped, error).
type publishResult struct {
	Discovered            int     `json:"discovered"`
	Created               int     `json:"created"`
	Updated               int     `json:"updated"`
	Unchanged             int     `json:"unchanged"`
	Reactivated           int     `json:"reactivated"`
	Missing               *int    `json:"missing"`
	Closed                int     `json:"closed"`
	CircuitBreakerTripped bool    `json:"circuitBreakerTripped"`
	Queued                int     `json:"queued"`
	Error                 *string `json:"error"`
	Summary               string  `json:"summary"`
}

// publishTestJob puts the test job on its company's "board" and runs, right
// now, the same sync a real company gets every five minutes. Matching users
// get an email queued, which the sender sends within seconds.
func (s *Server) publishTestJob(w http.ResponseWriter, r *http.Request, _ model.User) error {
	id, err := pathID(r)
	if err != nil {
		return err
	}
	testJob, err := store.TestJobByID(r.Context(), s.db, id)
	if err != nil {
		return err
	}
	if testJob == nil {
		return notFound("No such test job")
	}
	company, err := store.CompanyByID(r.Context(), s.db, testJob.CompanyID)
	if err != nil {
		return err
	}
	if !company.Active {
		return &apiError{status: http.StatusBadRequest, message: company.Name + " is disabled. Reactivate it first"}
	}
	if err := store.PublishTestJob(r.Context(), s.db, id, model.Now()); err != nil {
		return err
	}

	result, err := s.syncer.Sync(r.Context(), *company)
	if err != nil {
		return err
	}
	job, err := store.JobByExternalID(r.Context(), s.db, company.ID, id)
	if err != nil {
		return err
	}
	byStatus := map[string]int{}
	var published map[string]any
	if job != nil {
		if byStatus, err = store.NotificationCountsOf(r.Context(), s.db, job.ID); err != nil {
			return err
		}
		published = map[string]any{"id": job.ID, "status": job.Status, "title": job.Title}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"result": publishResult{
			Discovered:  result.Discovered,
			Created:     result.Created,
			Updated:     result.Updated,
			Unchanged:   result.Discovered - result.Created - result.Updated - result.Reopened,
			Reactivated: result.Reopened,
			Closed:      result.Closed,
			Queued:      result.Queued,
			Summary:     result.Summary(),
		},
		"job":                   published,
		"notificationsByStatus": byStatus,
	})
	return nil
}

// testCompany finds an admin-made company by its slug.
func (s *Server) testCompany(ctx context.Context, slug string) (*model.Company, error) {
	company, err := store.CompanyBySlug(ctx, s.db, slug)
	if err != nil {
		return nil, err
	}
	if company == nil || company.Platform != model.PlatformTest {
		return nil, notFound("No such test company")
	}
	return company, nil
}
