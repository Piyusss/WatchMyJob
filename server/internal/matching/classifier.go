// Package matching reads job postings (classifier.go) and decides whether a
// job matches a user's preferences (matcher.go).
package matching

import (
	"hash/maphash"
	"html"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"jobdrop/internal/model"
)

// Classify reads a job posting's title and description and works out what
// the matcher compares with a user's preferences: role family, level,
// opportunity type and years of experience. Plain pattern matching.
//
// typeFromBoard is the employment type when the board states one (Lever and
// Ashby do); otherwise it's read from the title.
func Classify(title, descriptionText string, typeFromBoard *model.OpportunityType) model.Classification {
	role, level := levelAndRole(title)
	class := model.Classification{RoleFamily: role, Level: level, OpportunityType: opportunityType(title)}
	if typeFromBoard != nil {
		class.OpportunityType = *typeFromBoard
	}
	class.ExperienceMin, class.ExperienceMax = requiredYears(descriptionText)
	return class
}

// ClassifyHTML is Classify for a board's posting whose description is HTML;
// ClassifyText for one in plain text. Both remember their answers: every
// sync reads every board again, and nearly all postings are the same as
// last time. Reading descriptions (HTML to text, then the patterns below)
// was about 80% of a sync's CPU time when profiled, so an unchanged posting
// is answered from memory instead.
func ClassifyHTML(title, descriptionHTML string, typeFromBoard *model.OpportunityType) model.Classification {
	return remembered(title, descriptionHTML, true, typeFromBoard)
}

func ClassifyText(title, description string, typeFromBoard *model.OpportunityType) model.Classification {
	return remembered(title, description, false, typeFromBoard)
}

// The remembered answers, by a 64-bit hash of the input (storing the input
// itself would mean keeping every description in memory). Two different
// postings with the same hash is too unlikely to matter. The map is emptied
// when it gets big, so it can't grow forever: the next sync then reads each
// posting once more.
var memo = struct {
	sync.Mutex
	seed    maphash.Seed
	answers map[uint64]model.Classification
}{seed: maphash.MakeSeed(), answers: map[uint64]model.Classification{}}

const memoLimit = 100_000 // about five times the postings we follow

type memoInput struct {
	title, description string
	isHTML             bool
	typeFromBoard      model.OpportunityType
}

func remembered(title, description string, isHTML bool, typeFromBoard *model.OpportunityType) model.Classification {
	input := memoInput{title: title, description: description, isHTML: isHTML}
	if typeFromBoard != nil {
		input.typeFromBoard = *typeFromBoard
	}
	key := maphash.Comparable(memo.seed, input)

	memo.Lock()
	answer, found := memo.answers[key]
	memo.Unlock()
	if !found {
		text := description
		if isHTML {
			text = HTMLToText(description)
		}
		answer = Classify(title, text, typeFromBoard)
		memo.Lock()
		if len(memo.answers) >= memoLimit {
			clear(memo.answers)
		}
		memo.answers[key] = answer
		memo.Unlock()
	}
	return copyOf(answer)
}

// copyOf returns c with its own copies of the values it points to, so no
// job ever shares a pointer with a remembered answer.
func copyOf(c model.Classification) model.Classification {
	c.RoleFamily = clone(c.RoleFamily)
	c.Level = clone(c.Level)
	c.ExperienceMin = clone(c.ExperienceMin)
	c.ExperienceMax = clone(c.ExperienceMax)
	return c
}

func clone[T any](p *T) *T {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

// ---- Opportunity type, from the title. A title without "intern",
// "contract" or "part-time" is a full-time role.
var (
	internWord   = regexp.MustCompile(`(?i)\bintern(ship)?\b`)
	contractWord = regexp.MustCompile(`(?i)\bcontract(or)?\b`)
	partTimeWord = regexp.MustCompile(`(?i)\bpart[\s-]?time\b`)
)

func opportunityType(title string) model.OpportunityType {
	switch {
	case internWord.MatchString(title):
		return model.Internship
	case contractWord.MatchString(title):
		return model.Contract
	case partTimeWord.MatchString(title):
		return model.PartTime
	}
	return model.FullTime
}

// ---- Level and role family, from the title. On real boards a seniority
// word always comes first ("Senior Software Engineer"), so the role family
// is whatever follows it. Longest words first, so "Entry Level" is tried
// before anything shorter.
var levelWords = []struct{ word, level string }{
	{"Entry Level", "Entry Level"},
	{"Entry-Level", "Entry Level"},
	{"Principal", "Principal"},
	{"Associate", "Associate"},
	{"Senior", "Senior"},
	{"Junior", "Junior"},
	{"Staff", "Staff"},
	{"Lead", "Lead"},
	{"Sr.", "Senior"},
	{"Jr.", "Junior"},
	{"Sr", "Senior"},
	{"Jr", "Junior"},
}

// "Software Engineer II", "SDE 3": a number at the very end is a level.
var numberedLevel = regexp.MustCompile(`\s+(I{1,3}|IV|V|[1-5])$`)

func levelAndRole(rawTitle string) (role, level *string) {
	title := Strip(rawTitle)
	for _, w := range levelWords {
		n := len(w.word)
		if len(title) > n && strings.EqualFold(title[:n], w.word) && startsWithSpace(title[n:]) {
			return cleanRole(title[n:]), &w.level
		}
	}
	if found := internWord.FindStringIndex(title); found != nil {
		intern := "Intern"
		return cleanRole(title[:found[0]] + title[found[1]:]), &intern
	}
	if found := numberedLevel.FindStringSubmatchIndex(title); found != nil {
		number := title[found[2]:found[3]]
		return cleanRole(title[:found[0]]), &number
	}
	return cleanRole(title), nil
}

// Tidies what's left of the title: no dangling commas or dashes, single spaces.
var (
	roleEdges     = regexp.MustCompile(`^[,\-–—\s]+|[,\-–—\s]+$`)
	repeatedSpace = regexp.MustCompile(`\s{2,}`)
)

func cleanRole(text string) *string {
	role := repeatedSpace.ReplaceAllString(roleEdges.ReplaceAllString(text, ""), " ")
	if role == "" {
		return nil
	}
	return &role
}

// ---- Years of experience, from the description: "5+ years",
// "3-5 years", "2 to 4 years". Only the text before a "nice to have" or
// "preferred" section counts, since what follows isn't a requirement.
var (
	preferredSection = regexp.MustCompile(
		`(?i)nice[- ]to[- ]have|preferred qualifications?|preferred:|bonus points?|a plus if|it'?s a plus|not required`)
	yearsPattern = regexp.MustCompile(
		`(?i)(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\+?\s*years?\b|(\d{1,2})\+?\s*years?\b`)
)

// requiredYears returns the range a description asks for; max is nil for
// an open-ended "5+ years", and both are nil when it names no number.
func requiredYears(description string) (min, max *int) {
	if found := preferredSection.FindStringIndex(description); found != nil {
		description = description[:found[0]]
	}
	groups := yearsPattern.FindStringSubmatch(description)
	switch {
	case groups == nil:
		return nil, nil
	case groups[1] != "":
		return number(groups[1]), number(groups[2])
	default:
		return number(groups[3]), nil
	}
}

func number(digits string) *int {
	n, _ := strconv.Atoi(digits) // the pattern only matches one or two digits
	return &n
}

// HTMLToText reduces a job board's HTML description to its words, which is
// all the classifier needs. Greenhouse escapes its HTML a second time
// ("&lt;p&gt;"), hence the two unescapes.
func HTMLToText(markup string) string {
	unescaped := html.UnescapeString(markup) // "&lt;p&gt;" becomes "<p>"
	text := htmlTag.ReplaceAllString(unescaped, " ")
	return Strip(whitespace.ReplaceAllString(html.UnescapeString(text), " ")) // "&amp;" in the text becomes "&"
}

var (
	htmlTag    = regexp.MustCompile(`<[^>]*>`)
	whitespace = regexp.MustCompile(`\s+`)
)

// ---- Whitespace the way the Java version saw it (Character.isWhitespace).
// Unlike strings.TrimSpace, a no-break space isn't whitespace here: some
// boards end titles with one, and trimming exactly as before keeps every
// stored title and role family as it was.
func isSpace(r rune) bool {
	if r == ' ' || r == ' ' || r == ' ' || r == '\u0085' {
		return false
	}
	return unicode.IsSpace(r) || r >= '\u001c' && r <= '\u001f'
}

// Strip trims the whitespace around text, as described above.
func Strip(text string) string {
	return strings.TrimFunc(text, isSpace)
}

func startsWithSpace(text string) bool {
	r, _ := utf8.DecodeRuneInString(text)
	return isSpace(r)
}
