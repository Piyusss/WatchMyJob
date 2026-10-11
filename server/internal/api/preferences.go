package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"jobdrop/internal/geo"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// levels are the level choices the website offers (its LEVEL_OPTIONS).
var levels = []string{"Intern", "Associate", "Senior", "Lead", "Staff", "Principal"}

type preferencesView struct {
	ID               string                  `json:"id"`
	UserID           string                  `json:"userId"`
	RoleFamily       *string                 `json:"roleFamily"`
	RoleLevel        *string                 `json:"roleLevel"`
	YearsExperience  *int                    `json:"yearsExperience"`
	ToleranceYears   *int                    `json:"toleranceYears"`
	Locations        []model.Location        `json:"locations"`
	WorkMode         []model.WorkMode        `json:"workMode"`
	OpportunityTypes []model.OpportunityType `json:"opportunityTypes"`
	EffectiveSince   time.Time               `json:"effectiveSince"`
	CreatedAt        time.Time               `json:"createdAt"`
	UpdatedAt        time.Time               `json:"updatedAt"`
}

func viewOfPreferences(p model.Preferences) preferencesView {
	return preferencesView{
		ID:               p.ID,
		UserID:           p.UserID,
		RoleFamily:       p.RoleFamily,
		RoleLevel:        p.RoleLevel,
		YearsExperience:  p.YearsExperience,
		ToleranceYears:   p.ToleranceYears,
		Locations:        p.Locations,
		WorkMode:         p.WorkModes,
		OpportunityTypes: p.OpportunityTypes,
		EffectiveSince:   p.EffectiveSince,
		CreatedAt:        p.CreatedAt,
		UpdatedAt:        p.UpdatedAt,
	}
}

func (s *Server) getPreferences(w http.ResponseWriter, r *http.Request, user model.User) error {
	prefs, err := store.PreferencesOf(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}
	var view *preferencesView
	if prefs != nil {
		v := viewOfPreferences(*prefs)
		view = &v
	}
	writeJSON(w, http.StatusOK, map[string]any{"preferences": view})
	return nil
}

// savePreferences replaces every setting: the form always sends all of them.
func (s *Server) savePreferences(w http.ResponseWriter, r *http.Request, user model.User) error {
	var body struct {
		RoleFamily       *string                 `json:"roleFamily"`
		RoleLevel        *string                 `json:"roleLevel"`
		YearsExperience  *int                    `json:"yearsExperience"`
		ToleranceYears   *int                    `json:"toleranceYears"`
		Locations        []locationInput         `json:"locations"`
		WorkMode         []model.WorkMode        `json:"workMode"`
		OpportunityTypes []model.OpportunityType `json:"opportunityTypes"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.maxLength("roleFamily", body.RoleFamily, 120)
	p.oneOf("roleLevel", body.RoleLevel, levels...)
	p.between("yearsExperience", body.YearsExperience, 0, 60)
	p.between("toleranceYears", body.ToleranceYears, 0, 20)
	p.locations(body.Locations)
	if err := p.err(); err != nil {
		return err
	}

	// "Any role" arrives as null. Any other role has to be one on an open
	// job right now, the same list the form's dropdown shows.
	roleFamily := trimmed(body.RoleFamily)
	if err := s.checkRoleFamily(r, roleFamily); err != nil {
		return err
	}
	locations, err := resolve(body.Locations)
	if err != nil {
		return err
	}

	prefs, err := store.PreferencesOf(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}
	if prefs == nil {
		prefs = &model.Preferences{ID: uuid.NewString(), UserID: user.ID}
	}
	prefs.Update(model.Settings{
		RoleFamily:       roleFamily,
		RoleLevel:        body.RoleLevel,
		YearsExperience:  body.YearsExperience,
		ToleranceYears:   body.ToleranceYears,
		Locations:        locations,
		WorkModes:        orEmpty(body.WorkMode),
		OpportunityTypes: orEmpty(body.OpportunityTypes),
	}, model.Now())
	if err := store.SavePreferences(r.Context(), s.db, prefs); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]any{"preferences": viewOfPreferences(*prefs)})
	return nil
}

// checkRoleFamily: a role, when picked, must be on an open job right now.
func (s *Server) checkRoleFamily(r *http.Request, roleFamily *string) error {
	if roleFamily == nil {
		return nil
	}
	open, err := store.IsOpenRoleFamily(r.Context(), s.db, *roleFamily)
	if err != nil {
		return err
	}
	if !open {
		return invalidField("roleFamily", "Not a currently available role")
	}
	return nil
}

// locations (public): the whole country → state → city tree for the location picker.
func (s *Server) locations(w http.ResponseWriter, r *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]any{"countries": geo.Countries})
	return nil
}

// locationInput is a picked place as a form sends it; geo.Resolve checks it.
type locationInput struct {
	CountryCode *string `json:"countryCode"`
	StateCode   *string `json:"stateCode"`
	CityName    *string `json:"cityName"`
}

// locations checks a form's list of places: at most 10, each with a country.
func (p problems) locations(inputs []locationInput) {
	p.size("locations", len(inputs), 0, 10)
	for i, in := range inputs {
		p.notBlank(fmt.Sprintf("locations[%d].countryCode", i), in.CountryCode)
	}
}

// resolve checks each place against the geo list; the first unknown one is the error.
func resolve(inputs []locationInput) ([]model.Location, error) {
	locations := []model.Location{}
	for _, in := range inputs {
		location, err := geo.Resolve(*in.CountryCode, in.StateCode, in.CityName)
		if err != nil {
			return nil, invalidField("locations", err.Error())
		}
		locations = append(locations, location)
	}
	return locations, nil
}

// orEmpty turns a missing list into an empty one, which the website reads as [].
func orEmpty[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
