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

// in is someone who wants jobs in any of those places, and nothing else.
func in(places ...model.Location) model.Preferences {
	return wants(model.Settings{Locations: places})
}

// locationCases checks, for each job location, whether it matches prefs.
func locationCases(t *testing.T, prefs model.Preferences, cases map[string]bool) {
	t.Helper()
	for location, want := range cases {
		job := openJob("Engineer")
		job.Location = &location
		if got := Matches(job, prefs); got != want {
			t.Errorf("%q: got %v, want %v", location, got, want)
		}
	}
}

var (
	india     = place("IN", nil, nil)
	bangalore = place("IN", ptr("KA"), ptr("Bangalore"))
)

func TestAnyOfTheChosenPlacesMatchesWhereverItIsNamed(t *testing.T) {
	locationCases(t, in(bangalore, place("US", nil, nil)), map[string]bool{
		"Bangalore, India":       true,
		"Remote - United States": true,
		"San Francisco, CA":      true, // in the US, without saying so
		"London":                 false,
	})
	if !Matches(openJob("Engineer"), in(bangalore)) {
		t.Error("a job that doesn't say where it is should match")
	}
}

// A job in a city is in its state and its country too, but a job somewhere
// in a state isn't necessarily in the city someone picked.
func TestAPlaceIsInsideThePlacesAroundIt(t *testing.T) {
	locationCases(t, in(india), map[string]bool{"Bengaluru": true, "Pune, Maharashtra": true})
	locationCases(t, in(place("IN", ptr("KA"), nil)), map[string]bool{"Bangalore": true, "Pune": false})
	locationCases(t, in(bangalore), map[string]bool{"Karnataka, India": false})
}

func TestAPlaceIsFoundUnderItsOtherNames(t *testing.T) {
	locationCases(t, in(bangalore), map[string]bool{"Bengaluru, Karnataka": true})
	locationCases(t, in(place("US", ptr("NY"), ptr("New York City"))), map[string]bool{"New York, NY": true, "NYC": true})
	locationCases(t, in(place("US", ptr("DC"), nil)), map[string]bool{"Washington, D.C.": true})
}

func TestAPlaceIsOnlyFoundAsWholeWords(t *testing.T) {
	locationCases(t, in(india), map[string]bool{"Indianapolis, IN": false, "Indiana": false})
}

// Cambridge is in Massachusetts and in England, and Washington is a state
// and a city: the rest of the text decides which is meant, if it can.
func TestANameOfTwoPlacesIsSettledByTheRestOfTheText(t *testing.T) {
	locationCases(t, in(place("GB", ptr("ENG"), ptr("Cambridge"))), map[string]bool{
		"Cambridge, MA": false, "Cambridge, UK": true, "Cambridge": true,
	})
	locationCases(t, in(place("US", ptr("WA"), nil)), map[string]bool{"Washington, DC": false, "Seattle, Washington": true})
	locationCases(t, in(place("US", ptr("DC"), nil)), map[string]bool{"Washington, DC": true, "Seattle, Washington": false})
}

// "CA" is California, but also Canada's country code; "IL" is Illinois,
// and Israel's code.
func TestAStateCodeCountsUnlessTheJobIsInAnotherCountry(t *testing.T) {
	locationCases(t, in(place("US", ptr("CA"), nil)), map[string]bool{"Sunnyvale, CA": true, "Toronto, ON, CA": false})
	locationCases(t, in(place("US", ptr("IL"), nil)), map[string]bool{"Chicago, IL": true, "Tel Aviv, IL": false})
}

func TestALocationThatNamesNoPlaceMatchesAnyone(t *testing.T) {
	locationCases(t, in(india), map[string]bool{
		"Remote": true, "Work from home": true, "Remote - US": false, "Remote - Europe": false,
	})
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

// Boards and the form name levels differently ("SDE 1", "Junior", the
// form's "Associate"); they're compared by their step on one ladder.
func TestLevelsAreComparedByTheirStepOnOneLadder(t *testing.T) {
	cases := []struct {
		wanted, title string
		want          bool
	}{
		{"Associate", "Software Engineer II", true},
		{"Associate", "SDE 1", true},
		{"Associate", "Junior Developer", true},
		{"Associate", "Entry Level Engineer", true},
		{"Associate", "Senior Engineer", false},
		{"Senior", "Software Engineer III", true},
		{"Lead", "Staff Engineer", true},
		{"Principal", "Staff Engineer", false},
	}
	for _, c := range cases {
		if got := Matches(openJob(c.title), wants(model.Settings{RoleLevel: ptr(c.wanted)})); got != c.want {
			t.Errorf("%s wanting %q: got %v, want %v", c.wanted, c.title, got, c.want)
		}
	}
}

// An open-ended "2+ years" only needs the top of the user's range to reach
// 2. A posting that names no level then passes; one that names another
// step of the ladder is kept away by the level rule.
func TestAnOpenEndedRequirementOnlyNeedsEnoughYears(t *testing.T) {
	seniorWithTen := wants(model.Settings{RoleLevel: ptr("Senior"), YearsExperience: ptr(10), ToleranceYears: ptr(0)})
	for title, want := range map[string]bool{"Senior Engineer": true, "Engineer": true, "Junior Engineer": false} {
		job := openJob(title)
		job.ExperienceMin = ptr(2)
		if got := Matches(job, seniorWithTen); got != want {
			t.Errorf("%q: got %v, want %v", title, got, want)
		}
	}
	associateWithOne := wants(model.Settings{RoleLevel: ptr("Associate"), YearsExperience: ptr(1), ToleranceYears: ptr(1)})
	job := openJob("Software Engineer")
	job.ExperienceMin = ptr(2)
	if !Matches(job, associateWithOne) {
		t.Error("a 2+ years posting with no level should reach someone with 1 to 2 years who picked a level")
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
