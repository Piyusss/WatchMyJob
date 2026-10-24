package api

import (
	"cmp"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"jobdrop/internal/matching"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// roleFamilies (public): the choices for the "role" dropdown, i.e. every
// role name on an open job.
func (s *Server) roleFamilies(w http.ResponseWriter, r *http.Request) error {
	families, err := store.RoleFamilies(r.Context(), s.db)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"roleFamilies": families})
	return nil
}

// jobFields are what the website shows about a job, both in a list and on its own page.
type jobFields struct {
	ID                      string                `json:"id"`
	Title                   string                `json:"title"`
	Location                *string               `json:"location"`
	WorkMode                *model.WorkMode       `json:"workMode"`
	SourceURL               string                `json:"sourceUrl"`
	PostedAt                *time.Time            `json:"postedAt"`
	FirstSeenAt             time.Time             `json:"firstSeenAt"`
	DiscoveredInInitialSync bool                  `json:"discoveredInInitialSync"`
	Status                  model.JobStatus       `json:"status"`
	RoleFamily              *string               `json:"roleFamily"`
	Level                   *string               `json:"level"`
	OpportunityType         model.OpportunityType `json:"opportunityType"`
	ExperienceStatus        string                `json:"experienceStatus"`
	RequiredExperienceMin   *int                  `json:"requiredExperienceMin"`
	RequiredExperienceMax   *int                  `json:"requiredExperienceMax"`
}

func fieldsOf(j model.Job) jobFields {
	return jobFields{
		ID:                      j.ID,
		Title:                   j.Title,
		Location:                j.Location,
		WorkMode:                j.WorkMode,
		SourceURL:               j.URL,
		PostedAt:                j.PostedAt,
		FirstSeenAt:             j.FirstSeenAt,
		DiscoveredInInitialSync: j.DiscoveredInInitialSync,
		Status:                  j.Status,
		RoleFamily:              j.RoleFamily,
		Level:                   j.Level,
		OpportunityType:         j.OpportunityType,
		ExperienceStatus:        j.ExperienceStatus(),
		RequiredExperienceMin:   j.ExperienceMin,
		RequiredExperienceMax:   j.ExperienceMax,
	}
}

// companySummary is how a job names its company.
type companySummary struct {
	Name   string  `json:"name"`
	Slug   string  `json:"slug"`
	Domain *string `json:"domain"`
}

func summaryOf(c model.Company) companySummary {
	return companySummary{c.Name, c.Slug, c.Domain}
}

type jobListing struct {
	jobFields
	Company          companySummary        `json:"company"`
	MatchExplanation *matching.Explanation `json:"matchExplanation"`
	UserState        *model.Mark           `json:"userState"`
}

// jobsPage: total counts the jobs after every filter; unfilteredTotal the
// open jobs at the watched companies; filtered is whether preferences
// narrowed the list.
type jobsPage struct {
	Jobs            []jobListing `json:"jobs"`
	NextCursor      *string      `json:"nextCursor"`
	Total           int          `json:"total"`
	UnfilteredTotal int          `json:"unfilteredTotal"`
	Filtered        bool         `json:"filtered"`
}

// jobsQuery is GET /api/jobs's query string. state switches to "the jobs I
// saved / applied to / dismissed" (watched or not, matching or not).
type jobsQuery struct {
	limit                                                   int
	cursor, sort, companies, roleFamily, level, location, q string
	workMode                                                *model.WorkMode
	opportunityType                                         *model.OpportunityType
	state                                                   *model.Mark
}

func parseJobsQuery(values url.Values) (jobsQuery, error) {
	q := jobsQuery{
		limit:      defaultPageSize,
		cursor:     values.Get("cursor"),
		sort:       values.Get("sort"),
		companies:  values.Get("companies"),
		roleFamily: values.Get("roleFamily"),
		level:      values.Get("level"),
		location:   values.Get("location"),
		q:          values.Get("q"),
	}
	if text := strings.TrimSpace(values.Get("limit")); text != "" {
		n, err := strconv.Atoi(text)
		if err != nil {
			return q, invalidField("limit", "must be a number")
		}
		q.limit = n
	}
	q.limit = min(max(q.limit, 1), maxPageSize)
	var err error
	if q.workMode, err = enumParam(values, "workMode", model.WorkModes); err != nil {
		return q, err
	}
	if q.opportunityType, err = enumParam(values, "opportunityType", model.OpportunityTypes); err != nil {
		return q, err
	}
	q.state, err = enumParam(values, "state", model.Marks)
	return q, err
}

func enumParam[T ~string](values url.Values, name string, allowed []T) (*T, error) {
	text := strings.TrimSpace(values.Get(name))
	if text == "" {
		return nil, nil
	}
	value, ok := model.Parse(text, allowed)
	if !ok {
		return nil, invalidField(name, "unknown value "+strconv.Quote(text))
	}
	return &value, nil
}

// listJobs is the dashboard's job list: open jobs at the companies a user
// watches, narrowed by their preferences (the same rules that decide who
// gets emailed), then by the search box and filters, sorted and paged.
// Everything is filtered in memory, which is fine at this scale; a much
// bigger dataset would need the jobs stored the way the feed reads them.
func (s *Server) listJobs(w http.ResponseWriter, r *http.Request, user model.User) error {
	query, err := parseJobsQuery(r.URL.Query())
	if err != nil {
		return err
	}
	ctx := r.Context()
	prefs, err := store.PreferencesOf(ctx, s.db, user.ID)
	if err != nil {
		return err
	}
	marks, err := store.MarksOf(ctx, s.db, user.ID)
	if err != nil {
		return err
	}

	candidates := []model.Job{}
	unfilteredTotal := 0
	if query.state != nil {
		// Everything the user marked this way, even closed jobs: "the role I
		// applied to has closed" is worth seeing.
		var ids []string
		for jobID, mark := range marks {
			if mark == *query.state {
				ids = append(ids, jobID)
			}
		}
		if len(ids) > 0 {
			if candidates, err = store.JobsByID(ctx, s.db, ids); err != nil {
				return err
			}
		}
		unfilteredTotal = len(candidates)
	} else {
		subs, err := store.SubscriptionsOf(ctx, s.db, user.ID)
		if err != nil {
			return err
		}
		if len(subs) == 0 {
			writeJSON(w, http.StatusOK, jobsPage{Jobs: []jobListing{}})
			return nil
		}
		watched := make([]model.Company, len(subs))
		for i, sub := range subs {
			watched[i] = sub.Company
		}
		open, err := store.OpenJobsAt(ctx, s.db, watched)
		if err != nil {
			return err
		}
		unfilteredTotal = len(open)
		for _, job := range open {
			// Dismissed jobs leave this user's feed only.
			if marks[job.ID] != model.Dismissed && (prefs == nil || matching.Matches(job, *prefs)) {
				candidates = append(candidates, job)
			}
		}
	}

	filtered := []model.Job{}
	for _, job := range candidates {
		if passesFilters(job, query) {
			filtered = append(filtered, job)
		}
	}
	sortJobs(filtered, query.sort)
	page, nextCursor := after(filtered, query.cursor, query.limit, func(j model.Job) string { return j.ID })

	listings := make([]jobListing, len(page))
	for i, job := range page {
		listings[i] = jobListing{fieldsOf(job), summaryOf(job.Company), explain(job, prefs), markOn(marks, job.ID)}
	}
	writeJSON(w, http.StatusOK, jobsPage{
		Jobs:            listings,
		NextCursor:      nextCursor,
		Total:           len(filtered),
		UnfilteredTotal: unfilteredTotal,
		Filtered:        query.state == nil && prefs != nil,
	})
	return nil
}

// passesFilters applies the search box and the filter controls. Text
// filters ignore case.
func passesFilters(job model.Job, q jobsQuery) bool {
	if strings.TrimSpace(q.companies) != "" {
		var slugs []string
		for _, slug := range strings.Split(q.companies, ",") {
			if slug = strings.ToLower(strings.TrimSpace(slug)); slug != "" {
				slugs = append(slugs, slug)
			}
		}
		if !slices.Contains(slugs, job.Company.Slug) {
			return false
		}
	}
	if !contains(job.RoleFamily, q.roleFamily) {
		return false
	}
	if level := strings.TrimSpace(q.level); level != "" && (job.Level == nil || !strings.EqualFold(level, *job.Level)) {
		return false
	}
	if q.workMode != nil && (job.WorkMode == nil || *job.WorkMode != *q.workMode) {
		return false
	}
	if q.opportunityType != nil && job.OpportunityType != *q.opportunityType {
		return false
	}
	if !contains(job.Location, q.location) {
		return false
	}
	if strings.TrimSpace(q.q) != "" {
		return contains(&job.Title, q.q) || contains(&job.Company.Name, q.q) || contains(job.Location, q.q)
	}
	return true
}

// contains: no search term means no filter.
func contains(text *string, term string) bool {
	term = strings.TrimSpace(term)
	if term == "" {
		return true
	}
	return text != nil && strings.Contains(strings.ToLower(*text), strings.ToLower(term))
}

// sortJobs: "newest" is when we first saw the job, "updated" when it last
// changed. Ties go by id so paging stays stable.
func sortJobs(jobs []model.Job, sort string) {
	slices.SortFunc(jobs, func(a, b model.Job) int {
		aTime, bTime := a.FirstSeenAt, b.FirstSeenAt
		if sort == "updated" {
			aTime, bTime = a.UpdatedAt, b.UpdatedAt
		}
		return cmp.Or(bTime.Compare(aTime), strings.Compare(a.ID, b.ID))
	})
}

// explain is the "why this matches" box, against the user's own
// preferences; nil when they haven't set any.
func explain(job model.Job, prefs *model.Preferences) *matching.Explanation {
	if prefs == nil {
		return nil
	}
	explanation := matching.Explain(job, *prefs)
	return &explanation
}

func markOn(marks map[string]model.Mark, jobID string) *model.Mark {
	mark, ok := marks[jobID]
	if !ok {
		return nil
	}
	return &mark
}

type jobPage struct {
	jobFields
	// Always "": descriptions aren't stored, the page links to the posting instead.
	Description      string                `json:"description"`
	Company          companyWithID         `json:"company"`
	UserState        *model.Mark           `json:"userState"`
	MatchExplanation *matching.Explanation `json:"matchExplanation"`
}

type companyWithID struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Slug   string  `json:"slug"`
	Domain *string `json:"domain"`
}

// pathJobID reads a job id ("<company slug>.<external id>") from the path.
func pathJobID(r *http.Request) (string, error) {
	id := r.PathValue("id")
	if _, _, ok := model.ParseJobID(id); !ok {
		return "", errBadInput
	}
	return id, nil
}

// jobDetail: any signed-in user may open any job.
func (s *Server) jobDetail(w http.ResponseWriter, r *http.Request, user model.User) error {
	id, err := pathJobID(r)
	if err != nil {
		return err
	}
	job, err := store.JobByID(r.Context(), s.db, id)
	if err != nil {
		return err
	}
	if job == nil {
		return notFound("Job not found")
	}
	prefs, err := store.PreferencesOf(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}
	mark, err := store.MarkOf(r.Context(), s.db, user.ID, job.ID)
	if err != nil {
		return err
	}
	c := job.Company
	writeJSON(w, http.StatusOK, map[string]any{"job": jobPage{
		jobFields:        fieldsOf(*job),
		Company:          companyWithID{c.Slug, c.Name, c.Slug, c.Domain},
		UserState:        mark,
		MatchExplanation: explain(*job, prefs),
	}})
	return nil
}

// setMark: save, mark applied or dismiss. A job has one mark at a time, so
// this replaces whatever mark it had.
func (s *Server) setMark(w http.ResponseWriter, r *http.Request, user model.User) error {
	id, err := pathJobID(r)
	if err != nil {
		return err
	}
	var body struct {
		State *model.Mark `json:"state"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.notNull("state", body.State == nil)
	if err := p.err(); err != nil {
		return err
	}
	job, err := store.JobByID(r.Context(), s.db, id)
	if err != nil {
		return err
	}
	if job == nil {
		return notFound("Job not found")
	}
	if err := store.SetMark(r.Context(), s.db, user.ID, id, *body.State); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobId": id, "state": *body.State})
	return nil
}

// clearMark removes the mark (un-save, or undo a dismiss). Removing no
// mark is fine too.
func (s *Server) clearMark(w http.ResponseWriter, r *http.Request, user model.User) error {
	id, err := pathJobID(r)
	if err != nil {
		return err
	}
	if err := store.ClearMark(r.Context(), s.db, user.ID, id); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobId": id, "state": nil})
	return nil
}
