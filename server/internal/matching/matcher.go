package matching

import (
	"slices"
	"strings"

	"jobdrop/internal/model"
)

// The six rules that decide whether a job matches someone's preferences.
// The same code picks who gets emailed about a new job and shows "why this
// matches" on the website, so the two can never disagree.

// Explanation is the website's "why this matches" box: one result per rule.
type Explanation struct {
	RoleMatched            bool `json:"roleMatched"`
	LevelMatched           bool `json:"levelMatched"`
	ExperienceMatched      bool `json:"experienceMatched"`
	LocationMatched        bool `json:"locationMatched"`
	WorkModeMatched        bool `json:"workModeMatched"`
	OpportunityTypeMatched bool `json:"opportunityTypeMatched"`
	OverallMatch           bool `json:"overallMatch"`
}

func Matches(job model.Job, prefs model.Preferences) bool {
	return Explain(job, prefs).OverallMatch
}

func Explain(job model.Job, prefs model.Preferences) Explanation {
	e := Explanation{
		RoleMatched:            roleMatches(job.RoleFamily, prefs.RoleFamily),
		LevelMatched:           levelMatches(job.Level, prefs.RoleLevel),
		ExperienceMatched:      experienceMatches(job, prefs),
		LocationMatched:        locationMatches(job.Location, prefs.Locations),
		WorkModeMatched:        len(prefs.WorkModes) == 0 || job.WorkMode == nil || slices.Contains(prefs.WorkModes, *job.WorkMode),
		OpportunityTypeMatched: opportunityTypeMatches(job.OpportunityType, prefs.OpportunityTypes),
	}
	e.OverallMatch = job.Status == model.Active && e.RoleMatched && e.LevelMatched && e.ExperienceMatched &&
		e.LocationMatched && e.WorkModeMatched && e.OpportunityTypeMatched
	return e
}

// No role picked ("Any role") matches everything. Otherwise the job's role
// must start with it: "Software Engineer" also matches "Software Engineer, Ads".
func roleMatches(jobRole, wanted *string) bool {
	if isBlank(wanted) {
		return true
	}
	return jobRole != nil && strings.HasPrefix(strings.ToLower(*jobRole), strings.ToLower(Strip(*wanted)))
}

// Most postings don't state a level. Those pass rather than vanish.
func levelMatches(jobLevel, wanted *string) bool {
	if isBlank(wanted) || isBlank(jobLevel) {
		return true
	}
	return strings.EqualFold(*jobLevel, Strip(*wanted))
}

// Any one of the user's places, found in the job's location text. Each
// place is its most specific part: the city, else the state, else the country.
func locationMatches(jobLocation *string, wanted []model.Location) bool {
	if len(wanted) == 0 || isBlank(jobLocation) {
		return true
	}
	text := strings.ToLower(*jobLocation)
	for _, place := range wanted {
		if strings.Contains(text, strings.ToLower(place.MostSpecificName())) {
			return true
		}
	}
	return false
}

// Unlike the other rules, picking nothing here means full-time only, so a
// user who never set it isn't sent internships or contracts.
func opportunityTypeMatches(jobType model.OpportunityType, wanted []model.OpportunityType) bool {
	if len(wanted) == 0 {
		return jobType == model.FullTime
	}
	return slices.Contains(wanted, jobType)
}

// The user's years, give or take their tolerance, must overlap what the
// job asks for. An open-ended "5+ years" only needs the top of the user's
// range to reach 5, so then the level must agree too (if the user picked
// one), or a very senior person would match every "1+ years" posting.
func experienceMatches(job model.Job, prefs model.Preferences) bool {
	if job.ExperienceStatus() == "UNKNOWN" || prefs.YearsExperience == nil {
		return true
	}
	tolerance := 0
	if prefs.ToleranceYears != nil {
		tolerance = *prefs.ToleranceYears
	}
	userMin := *prefs.YearsExperience - tolerance
	userMax := *prefs.YearsExperience + tolerance
	jobMin := 0
	if job.ExperienceMin != nil {
		jobMin = *job.ExperienceMin
	}

	if job.ExperienceMax != nil {
		return userMax >= jobMin && userMin <= *job.ExperienceMax
	}
	if !isBlank(prefs.RoleLevel) && (job.Level == nil || !strings.EqualFold(Strip(*prefs.RoleLevel), *job.Level)) {
		return false
	}
	return userMax >= jobMin
}

func isBlank(text *string) bool {
	return text == nil || Strip(*text) == ""
}
