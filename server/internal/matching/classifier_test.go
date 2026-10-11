package matching

import (
	"strconv"
	"testing"

	"jobdrop/internal/model"
)

func TestTheTitleGivesTheLevelAndTheRole(t *testing.T) {
	cases := []struct{ title, role, level string }{
		// A leading seniority word is the level, and the rest is the role.
		{"Senior Software Engineer", "Software Engineer", "Senior"},
		{"Sr. Backend Engineer", "Backend Engineer", "Senior"},
		{"Entry Level Data Analyst", "Data Analyst", "Entry Level"},
		// A trailing number is a level, and "intern" is a level anywhere.
		{"Software Engineer II", "Software Engineer", "II"},
		{"Software Engineering Intern", "Software Engineering", "Intern"},
		// A title without a level is all role.
		{"Product Designer", "Product Designer", "(none)"},
		// "Seniority" isn't "Senior": the word has to end where the title says so.
		{"Seniority Analyst", "Seniority Analyst", "(none)"},
	}
	for _, c := range cases {
		role, level := levelAndRole(c.title)
		if text(role) != c.role || text(level) != c.level {
			t.Errorf("%q: got role %q, level %q; want %q, %q", c.title, text(role), text(level), c.role, c.level)
		}
	}
}

func TestOpportunityTypeComesFromTheTitleUnlessTheBoardSaysSo(t *testing.T) {
	cases := map[string]model.OpportunityType{
		"Data Science Intern": model.Internship,
		"Contract Recruiter":  model.Contract,
		"Part-time Tutor":     model.PartTime,
		"Backend Engineer":    model.FullTime,
	}
	for title, want := range cases {
		if got := opportunityType(title); got != want {
			t.Errorf("%q: got %s, want %s", title, got, want)
		}
	}
	contract := model.Contract
	if got := Classify("Backend Engineer", "", &contract).OpportunityType; got != model.Contract {
		t.Errorf("the board's type should win, got %s", got)
	}
}

func TestYearsOfExperienceAreReadFromTheRequiredPartOfTheDescription(t *testing.T) {
	cases := []struct{ description, min, max string }{
		{"You have 5+ years of experience with Java.", "5", "(none)"},
		{"3-5 years building APIs", "3", "5"},
		{"2 to 4 years in a similar role", "2", "4"},
		{"3+ years required. Nice to have: 10 years of Kotlin", "3", "(none)"},
		{"Nice to have: 8 years with Go", "(none)", "(none)"},
		{"No numbers here", "(none)", "(none)"},
	}
	for _, c := range cases {
		min, max := requiredYears(c.description)
		if count(min) != c.min || count(max) != c.max {
			t.Errorf("%q: got %s to %s, want %s to %s", c.description, count(min), count(max), c.min, c.max)
		}
	}
}

func TestHTMLDescriptionsAreReducedToTheirText(t *testing.T) {
	// Greenhouse escapes its HTML a second time.
	if got := HTMLToText("&lt;p&gt;5+ years of Java &amp;amp; Spring&lt;/p&gt;"); got != "5+ years of Java & Spring" {
		t.Errorf("got %q", got)
	}
	if got := HTMLToText(""); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestARememberedAnswerIsTheSameAsAFreshOne(t *testing.T) {
	title, html := "Senior Backend Engineer", "&lt;p&gt;You have 3-5 years of Go.&lt;/p&gt;"
	first := ClassifyHTML(title, html, nil)
	again := ClassifyHTML(title, html, nil) // answered from memory
	for _, got := range []model.Classification{first, again} {
		if *got.RoleFamily != "Backend Engineer" || *got.Level != "Senior" || *got.ExperienceMin != 3 || *got.ExperienceMax != 5 {
			t.Errorf("got %s, %s, %d to %d", *got.RoleFamily, *got.Level, *got.ExperienceMin, *got.ExperienceMax)
		}
	}
	if first.RoleFamily == again.RoleFamily {
		t.Error("each answer should have its own copies, not share the memo's")
	}
	// The board's own employment type is part of what's remembered.
	contract := model.Contract
	if got := ClassifyHTML(title, html, &contract).OpportunityType; got != model.Contract {
		t.Errorf("got %s, want CONTRACT", got)
	}
}

func TestANoBreakSpaceIsKeptLikeTheJavaVersionDid(t *testing.T) {
	if got := Strip("  Data Engineer  "); got != "  Data Engineer  " {
		t.Errorf("got %q", got)
	}
	if got := Strip(" \t Data Engineer \n"); got != "Data Engineer" {
		t.Errorf("got %q", got)
	}
}

func text(value *string) string {
	if value == nil {
		return "(none)"
	}
	return *value
}

func count(value *int) string {
	if value == nil {
		return "(none)"
	}
	return strconv.Itoa(*value)
}
