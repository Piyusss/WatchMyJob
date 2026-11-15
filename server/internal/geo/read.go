package geo

import (
	"slices"
	"strings"
	"unicode"

	"jobdrop/internal/model"
)

// Reading where a job is. Boards write a job's location their own way:
// "Bengaluru, Karnataka, India", "New York, NY", "US - Remote". PlacesIn
// reads such text into places of the list above, so the matcher can
// compare them with the places a user picked.

// otherNames are other ways boards write a place of the list, by its key
// (see Key): another spelling, an older name, an abbreviation. US and UK
// count as names, not codes (see codes): nothing else is written that way.
var otherNames = map[string][]string{
	"US":                  {"US", "USA", "U.S.", "U.S.A."},
	"US/NY/New York City": {"New York", "NYC"},
	"US/DC":               {"Washington DC", "Washington D.C."},
	"IN/KA/Bangalore":     {"Bengaluru"},
	"IN/KA/Mysore":        {"Mysuru"},
	"IN/MH/Mumbai":        {"Bombay"},
	"IN/DL/New Delhi":     {"Delhi"},
	"GB":                  {"UK", "U.K.", "Great Britain", "Britain"},
	"CA/QC":               {"Québec"},
	"CA/QC/Montreal":      {"Montréal"},
	"DE":                  {"Deutschland"},
	"DE/BY":               {"Bayern"},
	"DE/BY/Munich":        {"München", "Muenchen"},
	"DE/HE":               {"Hessen"},
	"NL/NH":               {"Noord-Holland"},
	"NL/ZH":               {"Zuid-Holland"},
	"NL/ZH/The Hague":     {"Den Haag"},
	"FR/IDF":              {"Ile-de-France"},
	"KR":                  {"Korea"},
}

// codes are the short codes boards write after a city, as in "Austin, TX".
// A code is a weaker clue than a name, because codes clash: CA is also
// Canada's country code, and IL is Israel's. So a code only counts when no
// name in the text puts the job in another country. Codes that are also
// everyday words (Ontario's ON) are left out, and so are country codes,
// which clash with state codes (IN is India, and also Indiana).
var codes = map[string][]string{
	"US/CA":  {"CA"},
	"US/NY":  {"NY"},
	"US/WA":  {"WA"},
	"US/TX":  {"TX"},
	"US/IL":  {"IL"},
	"US/MA":  {"MA"},
	"US/DC":  {"DC", "D.C."},
	"CA/BC":  {"BC"},
	"CA/QC":  {"QC"},
	"IN/KA":  {"KA"},
	"IN/MH":  {"MH"},
	"IN/TG":  {"TG"},
	"AU/NSW": {"NSW"},
	"AU/VIC": {"VIC"},
}

// placeless are the words of a location that says how someone works but
// not where: "Remote", "Hybrid", "Anywhere", "Work from home".
var placeless = map[string]bool{
	"remote": true, "hybrid": true, "onsite": true, "on": true, "site": true, "office": true, "in": true,
	"anywhere": true, "any": true, "worldwide": true, "world": true, "the": true, "global": true,
	"globally": true, "distributed": true, "flexible": true, "virtual": true, "fully": true, "work": true,
	"from": true, "home": true, "wfh": true, "location": true, "locations": true, "or": true, "and": true,
}

// A meaning is a place a name may stand for. A weak one comes from a code.
type meaning struct {
	key  string
	weak bool
}

// meanings maps every name and code, normalized, to the places it may stand
// for. That's usually one, but "Cambridge" is in Massachusetts and in
// England, and "Washington" is a state and a city. longestName is the most
// words in one name ("district of columbia" has three).
var meanings, longestName = index()

func index() (map[string][]meaning, int) {
	found := map[string][]meaning{}
	longest := 0
	add := func(name, key string, weak bool) {
		normalized := normalize(name)
		found[normalized] = append(found[normalized], meaning{key, weak})
		longest = max(longest, strings.Count(normalized, " ")+1)
	}
	for _, country := range Countries {
		add(country.Name, country.Code, false)
		for _, state := range country.States {
			stateKey := country.Code + "/" + state.Code
			add(state.Name, stateKey, false)
			for _, city := range state.Cities {
				add(city, stateKey+"/"+city, false)
			}
		}
	}
	for key, names := range otherNames {
		for _, name := range names {
			add(name, key, false)
		}
	}
	for key, names := range codes {
		for _, name := range names {
			add(name, key, true)
		}
	}
	return found, longest
}

// PlacesIn reads which places of the list a job's location names (their
// keys, see Key), and whether it names a place at all: "Remote" and "Work
// from home" don't, and neither does an empty location.
//
// Every run of up to longestName words is looked up as a name, so a place
// is only found as whole words: "India" isn't in "Indianapolis". A name
// that stands for one place settles it, and a code counts unless the names
// put the job in other countries only. A name that may stand for more than
// one place keeps the ones that agree with the rest of the text ("Cambridge,
// MA" is the one in Massachusetts), or all of them when nothing settles it.
func PlacesIn(location string) (keys []string, namesAPlace bool) {
	text := normalize(location)
	var starts []int // where each word of text starts
	for i := range len(text) {
		if i == 0 || text[i-1] == ' ' {
			starts = append(starts, i)
		}
	}
	end := func(word int) int {
		if word+1 < len(starts) {
			return starts[word+1] - 1
		}
		return len(text)
	}

	var sure, clues []string // places named for certain; codes' places
	var unsure [][]string    // each a name's possible places
	for first := range starts {
		if !placeless[text[starts[first]:end(first)]] {
			namesAPlace = true
		}
		for last := first; last < len(starts) && last < first+longestName; last++ {
			var strong, weak []string
			for _, m := range meanings[text[starts[first]:end(last)]] {
				if m.weak {
					weak = append(weak, m.key)
				} else {
					strong = append(strong, m.key)
				}
			}
			switch {
			case len(strong) == 1:
				sure = append(sure, strong[0])
			case len(strong) > 1:
				unsure = append(unsure, strong)
			default:
				clues = append(clues, weak...)
			}
		}
	}

	for _, clue := range clues {
		if len(sure) == 0 || slices.ContainsFunc(sure, func(key string) bool { return country(key) == country(clue) }) {
			keys = append(keys, clue)
		}
	}
	keys = append(keys, sure...)
	settled := slices.Clone(keys)
	for _, places := range unsure {
		agree := slices.DeleteFunc(slices.Clone(places), func(place string) bool {
			return !slices.ContainsFunc(settled, func(key string) bool { return Within(place, key) || Within(key, place) })
		})
		if len(agree) == 0 {
			agree = places
		}
		keys = append(keys, agree...)
	}
	return keys, namesAPlace
}

// Key identifies a picked place the way PlacesIn names places: "IN",
// "IN/KA" or "IN/KA/Bangalore".
func Key(l model.Location) string {
	key := l.CountryCode
	if l.StateCode != nil {
		key += "/" + *l.StateCode
		if l.CityName != nil {
			key += "/" + *l.CityName
		}
	}
	return key
}

// Within reports whether the place with that key is area or inside it:
// Bangalore is within Karnataka, and within India.
func Within(key, area string) bool {
	return key == area || strings.HasPrefix(key, area+"/")
}

func country(key string) string {
	code, _, _ := strings.Cut(key, "/")
	return code
}

// normalize lowers text and turns everything but letters and digits into
// single spaces: "Washington, D.C." becomes "washington d c".
func normalize(text string) string {
	var b strings.Builder
	space := true // at the start, or just after a space
	for _, r := range strings.ToLower(text) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			space = false
		case !space:
			b.WriteByte(' ')
			space = true
		}
	}
	return strings.TrimSuffix(b.String(), " ")
}
