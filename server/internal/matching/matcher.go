package matching

import (
	"slices"
	"strings"

	"jobdrop/internal/geo"
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

// ladder puts every level the classifier reads from a title, and every
// level the preferences form offers, on one ladder of steps, because they
// name the same steps differently: a board's "Junior", "Entry Level",
// "SDE 1" and "Software Engineer II" are all the step the form calls
// Associate. Numbered levels differ a little between companies; these are
// their usual steps.
var ladder = map[string]int{
	"intern":    0,
	"associate": 1, "junior": 1, "entry level": 1, "i": 1, "1": 1, "ii": 1, "2": 1,
	"senior": 2, "iii": 2, "3": 2,
	"lead": 3, "staff": 3, "iv": 3, "4": 3,
	"principal": 4, "v": 4, "5": 4,
}

// A job's level must be on the user's step of the ladder. Most postings
// don't state a level: those, like any level the ladder doesn't know,
// pass rather than vanish.
func levelMatches(jobLevel, wanted *string) bool {
	if isBlank(wanted) || isBlank(jobLevel) {
		return true
	}
	jobStep, known := ladder[strings.ToLower(Strip(*jobLevel))]
	if !known {
		return true
	}
	wantedStep, ok := ladder[strings.ToLower(Strip(*wanted))]
	return ok && jobStep == wantedStep
}

// Any one of the user's places must be where the job is. The job's location
// text is read into places of the same list (geo.PlacesIn), and a place is
// inside the ones around it: a job in "Bengaluru" matches a user who picked
// Bangalore, Karnataka or India. A job that doesn't say where it is (no
// location, or just "Remote") matches anyone.
func locationMatches(jobLocation *string, wanted []model.Location) bool {
	if len(wanted) == 0 || jobLocation == nil {
		return true
	}
	places, namesAPlace := geo.PlacesIn(*jobLocation)
	if !namesAPlace {
		return true
	}
	for _, want := range wanted {
		area := geo.Key(want)
		if slices.ContainsFunc(places, func(place string) bool { return geo.Within(place, area) }) {
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
// range to reach 5. That lets a very senior person match a "1+ years"
// posting: the level rule still keeps one that names its level ("Junior
// Engineer") from them, and one that doesn't is sent rather than missed.
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
	return userMax >= jobMin
}

func isBlank(text *string) bool {
	return text == nil || Strip(*text) == ""
}
