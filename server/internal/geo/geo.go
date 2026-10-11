// Package geo is the list of places users can pick: a hand-picked (not
// complete) list of countries, their states or regions, and the main
// tech-hiring cities in each. The website gets the whole tree in one
// response for its location picker. City-sized countries (Singapore) have
// one region named after themselves, so every country is exactly three
// levels deep.
package geo

import (
	"errors"
	"slices"
	"strings"

	"jobdrop/internal/model"
)

type State struct {
	Code   string   `json:"code"`
	Name   string   `json:"name"`
	Cities []string `json:"cities"`
}

type Country struct {
	Code   string  `json:"code"`
	Name   string  `json:"name"`
	States []State `json:"states"`
}

func state(code, name string, cities ...string) State {
	return State{Code: code, Name: name, Cities: cities}
}

var Countries = []Country{
	{"US", "United States", []State{
		state("CA", "California", "San Francisco", "Mountain View", "Palo Alto", "San Jose", "Los Angeles"),
		state("NY", "New York", "New York City", "Brooklyn"),
		state("WA", "Washington", "Seattle", "Bellevue"),
		state("TX", "Texas", "Austin", "Dallas", "Houston"),
		state("IL", "Illinois", "Chicago"),
		state("MA", "Massachusetts", "Boston", "Cambridge"),
		state("DC", "District of Columbia", "Washington"),
	}},
	{"IN", "India", []State{
		state("KA", "Karnataka", "Bangalore", "Mysore"),
		state("MH", "Maharashtra", "Pune", "Mumbai"),
		state("TG", "Telangana", "Hyderabad"),
		state("TN", "Tamil Nadu", "Chennai", "Coimbatore"),
		state("DL", "Delhi", "New Delhi"),
		state("PB", "Punjab", "Mohali", "Chandigarh"),
	}},
	{"GB", "United Kingdom", []State{
		state("ENG", "England", "London", "Manchester", "Cambridge"),
		state("SCT", "Scotland", "Edinburgh", "Glasgow"),
	}},
	{"CA", "Canada", []State{
		state("ON", "Ontario", "Toronto", "Ottawa"),
		state("BC", "British Columbia", "Vancouver"),
		state("QC", "Quebec", "Montreal"),
	}},
	{"DE", "Germany", []State{
		state("BY", "Bavaria", "Munich"),
		state("BE", "Berlin", "Berlin"),
		state("HE", "Hesse", "Frankfurt"),
	}},
	{"NL", "Netherlands", []State{
		state("NH", "North Holland", "Amsterdam"),
		state("ZH", "South Holland", "Rotterdam", "The Hague"),
	}},
	{"AU", "Australia", []State{
		state("NSW", "New South Wales", "Sydney"),
		state("VIC", "Victoria", "Melbourne"),
	}},
	{"FR", "France", []State{state("IDF", "Île-de-France", "Paris")}},
	{"JP", "Japan", []State{state("13", "Tokyo", "Tokyo")}},
	{"SG", "Singapore", []State{state("SG", "Singapore", "Singapore")}},
	{"IE", "Ireland", []State{state("L", "Leinster", "Dublin")}},
	{"KR", "South Korea", []State{state("11", "Seoul", "Seoul")}},
	{"SE", "Sweden", []State{state("AB", "Stockholm County", "Stockholm")}},
	{"IL", "Israel", []State{state("TA", "Tel Aviv District", "Tel Aviv")}},
}

// Resolve checks a picked place against the list and fills in its display
// names. A state is optional; a city needs its state. The error is the
// message the website shows under the location picker.
func Resolve(countryCode string, stateCode, cityName *string) (model.Location, error) {
	i := slices.IndexFunc(Countries, func(c Country) bool { return c.Code == countryCode })
	if i < 0 {
		return model.Location{}, errors.New("Unknown country")
	}
	country := Countries[i]
	if isBlank(stateCode) {
		if !isBlank(cityName) {
			return model.Location{}, errors.New("A city requires a state")
		}
		return model.Location{CountryCode: country.Code, CountryName: country.Name}, nil
	}
	j := slices.IndexFunc(country.States, func(s State) bool { return s.Code == *stateCode })
	if j < 0 {
		return model.Location{}, errors.New("Unknown state for this country")
	}
	region := country.States[j]
	location := model.Location{CountryCode: country.Code, CountryName: country.Name, StateCode: &region.Code, StateName: &region.Name}
	if !isBlank(cityName) {
		city := strings.TrimSpace(*cityName)
		if !slices.Contains(region.Cities, city) {
			return model.Location{}, errors.New("Unknown city for this state")
		}
		location.CityName = &city
	}
	return location, nil
}

func isBlank(text *string) bool {
	return text == nil || strings.TrimSpace(*text) == ""
}
