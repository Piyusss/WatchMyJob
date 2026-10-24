package api

import (
	"cmp"
	"net/http"
	"slices"
	"strings"
	"time"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

type companyListItem struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Slug      string  `json:"slug"`
	Domain    *string `json:"domain"`
	OpenRoles int     `json:"openRoles"`
}

// listCompanies (public): every company users can watch, with its number
// of open roles. (A company's id is its slug.)
func (s *Server) listCompanies(w http.ResponseWriter, r *http.Request) error {
	companies, err := store.SelectableCompanies(r.Context(), s.db)
	if err != nil {
		return err
	}
	items := make([]companyListItem, len(companies))
	for i, c := range companies {
		items[i] = companyListItem{c.Slug, c.Name, c.Slug, c.Domain, c.OpenJobs}
	}
	writeJSON(w, http.StatusOK, map[string]any{"companies": items})
	return nil
}

type roleFamilyCount struct {
	RoleFamily string `json:"roleFamily"`
	Count      int    `json:"count"`
}

type recentJob struct {
	ID              string                `json:"id"`
	Title           string                `json:"title"`
	Location        *string               `json:"location"`
	WorkMode        *model.WorkMode       `json:"workMode"`
	OpportunityType model.OpportunityType `json:"opportunityType"`
	FirstSeenAt     time.Time             `json:"firstSeenAt"`
	RoleFamily      *string               `json:"roleFamily"`
	Level           *string               `json:"level"`
}

type companyDetail struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Slug         string            `json:"slug"`
	Status       string            `json:"status"`
	Domain       *string           `json:"domain"`
	OpenRoles    int               `json:"openRoles"`
	Watching     bool              `json:"watching"`
	LastSyncedAt *time.Time        `json:"lastSyncedAt"`
	RoleFamilies []roleFamilyCount `json:"roleFamilies"`
	RecentJobs   []recentJob       `json:"recentJobs"`
}

// companyDetail is a company's page: what it's hiring for, its latest
// roles, and whether the signed-in user watches it.
func (s *Server) companyDetail(w http.ResponseWriter, r *http.Request, user model.User) error {
	company, err := store.CompanyBySlug(r.Context(), s.db, r.PathValue("slug"))
	if err != nil {
		return err
	}
	if company == nil || !company.Selectable() {
		return notFound("Company not found")
	}
	open, err := store.OpenJobsOfCompany(r.Context(), s.db, *company)
	if err != nil {
		return err
	}
	watching, err := store.IsWatching(r.Context(), s.db, user.ID, company.Slug)
	if err != nil {
		return err
	}

	// What it hires for again and again: role families with 2+ open roles, top 8.
	counts := map[string]int{}
	for _, job := range open {
		if job.RoleFamily != nil {
			counts[*job.RoleFamily]++
		}
	}
	families := []roleFamilyCount{}
	for family, n := range counts {
		if n >= 2 {
			families = append(families, roleFamilyCount{family, n})
		}
	}
	slices.SortFunc(families, func(a, b roleFamilyCount) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), strings.Compare(a.RoleFamily, b.RoleFamily))
	})
	families = families[:min(len(families), 8)]

	recent := make([]recentJob, min(len(open), 10))
	for i := range recent {
		j := open[i]
		recent[i] = recentJob{j.ID, j.Title, j.Location, j.WorkMode, j.OpportunityType, j.FirstSeenAt, j.RoleFamily, j.Level}
	}

	writeJSON(w, http.StatusOK, map[string]any{"company": companyDetail{
		ID:           company.Slug,
		Name:         company.Name,
		Slug:         company.Slug,
		Status:       company.Status(),
		Domain:       company.Domain,
		OpenRoles:    len(open),
		Watching:     watching,
		LastSyncedAt: company.LastSyncedAt,
		RoleFamilies: families,
		RecentJobs:   recent,
	}})
	return nil
}
