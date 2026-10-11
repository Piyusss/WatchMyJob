package matching

import (
	"testing"
	"time"

	"jobdrop/internal/geo"
	"jobdrop/internal/model"
)

var now = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// openJob is an open, full-time job; its title gives its role and level,
// as on a real board. Tests then set whatever else they need.
func openJob(title string) model.Job {
	role, level := levelAndRole(title)
	job := model.Job{ID: "1", ExternalID: "1", FirstSeenAt: now, UpdatedAt: now}
	job.Update(model.Posting{ExternalID: "1", Title: title, URL: "https://example.com/job",
		Classification: model.Classification{RoleFamily: role, Level: level, OpportunityType: model.FullTime}}, now)
	return job
}

func wants(settings model.Settings) model.Preferences {
	return model.Preferences{Settings: settings}
}

func ptr[T any](value T) *T {
	return &value
}

func place(country string, state, city *string) model.Location {
	location, err := geo.Resolve(country, state, city)
	if err != nil {
		panic(err)
	}
	return location
}

func TestEmptyPreferencesMatchAnyOpenFullTimeJob(t *testing.T) {
	job := openJob("Backend Engineer")
	job.Location = ptr("Berlin")
	if !Matches(job, wants(model.Settings{})) {
		t.Error("should match")
	}
}

func TestTheRoleMatchesByItsStart(t *testing.T) {
	if !Matches(openJob("Software Engineer, Ads"), wants(model.Settings{RoleFamily: ptr("Software Engineer")})) {
		t.Error("a longer role starting with the wanted one should match")
	}
	if !Matches(openJob("Senior Software Engineer"), wants(model.Settings{RoleFamily: ptr("software engineer")})) {
		t.Error("case shouldn't matter")
	}
	if Explain(openJob("Product Designer"), wants(model.Settings{RoleFamily: ptr("Software Engineer")})).RoleMatched {
		t.Error("another role shouldn't match")
	}
}

func TestAJobWithoutALevelStillMatchesALevelPreference(t *testing.T) {
	senior := wants(model.Settings{RoleLevel: ptr("Senior")})
	for title, want := range map[string]bool{"Senior Engineer": true, "Engineer": true, "Staff Engineer": false} {
		if got := Matches(openJob(title), senior); got != want {
			t.Errorf("%q: got %v, want %v", title, got, want)
		}
	}
}

func TestAnyOfTheChosenPlacesMatchesItsMostSpecificName(t *testing.T) {
	places := wants(model.Settings{Locations: []model.Location{
		place("IN", ptr("KA"), ptr("Bangalore")),
		place("US", nil, nil),
	}})
	for location, want := range map[string]bool{"Bangalore, India": true, "Remote - United States": true, "London": false} {
		job := openJob("Engineer")
		job.Location = &location
		if got := Matches(job, places); got != want {
			t.Errorf("%q: got %v, want %v", location, got, want)
		}
	}
	if !Matches(openJob("Engineer"), places) {
		t.Error("a job that doesn't say where it is should match")
	}
}

func TestWorkModeMustBeOneOfTheChosenOnesWhenTheJobStatesIt(t *testing.T) {
	remoteOnly := wants(model.Settings{WorkModes: []model.WorkMode{model.Remote}})
	for mode, want := range map[model.WorkMode]bool{model.Remote: true, model.Hybrid: false} {
		job := openJob("Engineer")
		job.WorkMode = &mode
		if got := Matches(job, remoteOnly); got != want {
			t.Errorf("%s: got %v, want %v", mode, got, want)
		}
	}
	if !Matches(openJob("Engineer"), remoteOnly) {
		t.Error("a job that doesn't state a work mode should match")
	}
}

func TestChoosingNoOpportunityTypeMeansFullTimeOnly(t *testing.T) {
	internship := openJob("Engineer")
	internship.OpportunityType = model.Internship
	if Matches(internship, wants(model.Settings{})) {
		t.Error("an internship shouldn't match someone who chose no type")
	}
	if !Matches(internship, wants(model.Settings{OpportunityTypes: []model.OpportunityType{model.Internship}})) {
		t.Error("an internship should match someone who chose internships")
	}
}

func TestExperienceRangesMustOverlap(t *testing.T) {
	fourYears := wants(model.Settings{YearsExperience: ptr(4), ToleranceYears: ptr(1)}) // 3 to 5 years
	cases := []struct {
		min, max *int
		want     bool
	}{
		{ptr(3), ptr(5), true},
		{ptr(6), ptr(8), false},
		{ptr(5), nil, true},  // "5+ years"
		{ptr(6), nil, false}, // "6+ years"
		{nil, nil, true},     // not stated
	}
	for _, c := range cases {
		job := openJob("Engineer")
		job.ExperienceMin, job.ExperienceMax = c.min, c.max
		if got := Matches(job, fourYears); got != c.want {
			t.Errorf("%s to %s years: got %v, want %v", count(c.min), count(c.max), got, c.want)
		}
	}
}

func TestAnOpenEndedRequirementAlsoNeedsTheLevelToAgree(t *testing.T) {
	seniorWithTen := wants(model.Settings{RoleLevel: ptr("Senior"), YearsExperience: ptr(10), ToleranceYears: ptr(0)})
	for title, want := range map[string]bool{"Senior Engineer": true, "Engineer": false} {
		job := openJob(title)
		job.ExperienceMin = ptr(2)
		if got := Matches(job, seniorWithTen); got != want {
			t.Errorf("%q: got %v, want %v", title, got, want)
		}
	}
}

func TestAClosedJobNeverMatches(t *testing.T) {
	closed := openJob("Backend Engineer")
	closed.Close(now)
	explanation := Explain(closed, wants(model.Settings{}))
	if !explanation.RoleMatched || explanation.OverallMatch {
		t.Errorf("got %+v", explanation)
	}
}
