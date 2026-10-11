// Package model holds the app's data: one struct per database table, the
// enums stored in them, and the few rules that belong to the data itself.
// Everything here is plain data; the SQL that loads and saves it is in
// package store.
package model

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Now is the time to record in the database. Postgres keeps microseconds,
// so the value is cut to that: what an API response returns then matches
// what a later read of the same row returns.
func Now() time.Time {
	return time.Now().UTC().Truncate(time.Microsecond)
}

// ---- Enums. Each is stored, and sent to the website, as its name.

// Platform is where a company's openings come from. A TEST company is made
// in the admin pages, and its "board" is the test_jobs table.
type Platform string

const (
	PlatformGreenhouse Platform = "GREENHOUSE"
	PlatformLever      Platform = "LEVER"
	PlatformAshby      Platform = "ASHBY"
	PlatformTest       Platform = "TEST"
)

type WorkMode string

const (
	Remote WorkMode = "REMOTE"
	Hybrid WorkMode = "HYBRID"
	OnSite WorkMode = "ON_SITE"
)

var WorkModes = []WorkMode{Remote, Hybrid, OnSite}

type OpportunityType string

const (
	FullTime   OpportunityType = "FULL_TIME"
	Internship OpportunityType = "INTERNSHIP"
	Contract   OpportunityType = "CONTRACT"
	PartTime   OpportunityType = "PART_TIME"
	OtherType  OpportunityType = "OTHER"
)

var OpportunityTypes = []OpportunityType{FullTime, Internship, Contract, PartTime, OtherType}

type JobStatus string

const (
	Active JobStatus = "ACTIVE"
	Closed JobStatus = "CLOSED"
)

// Mark is a user's own mark on a job. A job has one mark at a time, so
// marking a saved job as applied replaces it.
type Mark string

const (
	Saved     Mark = "SAVED"
	Applied   Mark = "APPLIED"
	Dismissed Mark = "DISMISSED"
)

var Marks = []Mark{Saved, Applied, Dismissed}

// NotificationStatus: PROVIDER_ACCEPTED means the email provider took the
// email for delivery (the website shows it as "Sent"). These are the names
// the website expects.
type NotificationStatus string

const (
	Queued           NotificationStatus = "QUEUED"
	ProviderAccepted NotificationStatus = "PROVIDER_ACCEPTED"
	Failed           NotificationStatus = "FAILED"
	Skipped          NotificationStatus = "SKIPPED"
)

// Parse returns text as one of the allowed values, or false when it's none of them.
func Parse[T ~string](text string, allowed []T) (T, bool) {
	for _, value := range allowed {
		if T(text) == value {
			return value, true
		}
	}
	return "", false
}

// A request body with an unknown enum value is rejected before any handler
// runs: decoding it fails, which the API answers with 400 "Invalid input".

func (w *WorkMode) UnmarshalJSON(data []byte) error {
	return decodeEnum(data, w, WorkModes)
}

func (t *OpportunityType) UnmarshalJSON(data []byte) error {
	return decodeEnum(data, t, OpportunityTypes)
}

func (m *Mark) UnmarshalJSON(data []byte) error {
	return decodeEnum(data, m, Marks)
}

func decodeEnum[T ~string](data []byte, into *T, allowed []T) error {
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return err
	}
	value, ok := Parse(text, allowed)
	if !ok {
		return fmt.Errorf("unknown value %q", text)
	}
	*into = value
	return nil
}

// ---- Tables.

// User is a person using the site. Clerk owns the actual account (sign-in,
// password, Google); this row holds what the app itself needs.
type User struct {
	ID                  string
	ClerkUserID         string
	Name                string
	Email               string
	EmailVerified       bool
	NotificationsPaused bool
	// Lets the "Unsubscribe" link in every email pause alerts without signing in.
	UnsubscribeToken string
	CreatedAt        time.Time
}

// Company is an employer whose job board we follow.
type Company struct {
	ID       string
	Slug     string
	Name     string
	Domain   *string
	Platform Platform
	// The company's id on its board, e.g. "airbnb" for
	// boards.greenhouse.io/airbnb. Empty for a TEST company.
	BoardID string
	Active  bool
	// The first sync records the jobs already open as a baseline, which never
	// sends emails. Until it has run, users can't watch the company.
	InitialSyncDone bool
	LastSyncedAt    *time.Time
	CreatedAt       time.Time
}

// Selectable reports whether users can watch it: it's active and has its baseline.
func (c Company) Selectable() bool {
	return c.Active && c.InitialSyncDone
}

func (c Company) Status() string {
	if c.Active {
		return "ACTIVE"
	}
	return "INACTIVE"
}

// Job is one opening at a company, as last read from its job board.
type Job struct {
	ID string
	// The job's own id on the board: how the next sync recognises it.
	ExternalID      string
	Title           string
	Location        *string
	WorkMode        *WorkMode
	OpportunityType OpportunityType
	// Worked out from the title and description by the classifier.
	RoleFamily    *string
	Level         *string
	ExperienceMin *int
	ExperienceMax *int
	URL           string
	PostedAt      *time.Time
	Status        JobStatus
	// Already open when we started following the company: part of the
	// baseline, so it never triggers an email.
	DiscoveredInInitialSync bool
	FirstSeenAt             time.Time
	// The last time anything above changed.
	UpdatedAt time.Time
	// Every query that loads jobs joins in their company.
	Company Company
}

// Classification is what the classifier reads from a posting's title and
// description, and what the matcher compares with a user's preferences.
type Classification struct {
	RoleFamily      *string
	Level           *string
	OpportunityType OpportunityType
	ExperienceMin   *int
	ExperienceMax   *int
}

// Posting is a job as a board lists it, already classified.
type Posting struct {
	ExternalID string
	Title      string
	Location   *string
	WorkMode   *WorkMode
	URL        string
	PostedAt   *time.Time
	Classification
}

// Update copies the board's current version of the job (reopening it if it
// had closed) and reports whether anything actually changed.
func (j *Job) Update(p Posting, now time.Time) bool {
	before := *j
	j.Title = p.Title
	j.Location = p.Location
	j.WorkMode = p.WorkMode
	j.URL = p.URL
	j.PostedAt = p.PostedAt
	j.RoleFamily = p.RoleFamily
	j.Level = p.Level
	j.OpportunityType = p.OpportunityType
	j.ExperienceMin = p.ExperienceMin
	j.ExperienceMax = p.ExperienceMax
	j.Status = Active

	changed := before.Title != j.Title || !samePtr(before.Location, j.Location) ||
		!samePtr(before.WorkMode, j.WorkMode) || before.URL != j.URL || !sameTime(before.PostedAt, j.PostedAt) ||
		!samePtr(before.RoleFamily, j.RoleFamily) || !samePtr(before.Level, j.Level) ||
		before.OpportunityType != j.OpportunityType || !samePtr(before.ExperienceMin, j.ExperienceMin) ||
		!samePtr(before.ExperienceMax, j.ExperienceMax) || before.Status != j.Status
	if changed {
		j.UpdatedAt = now
	}
	return changed
}

func (j *Job) Close(now time.Time) {
	j.Status = Closed
	j.UpdatedAt = now
}

// ExperienceStatus is "KNOWN" when the posting says how many years of experience it wants.
func (j Job) ExperienceStatus() string {
	if j.ExperienceMin != nil || j.ExperienceMax != nil {
		return "KNOWN"
	}
	return "UNKNOWN"
}

// Location is one picked place: a country, optionally narrowed to a state
// and a city. The display names are stored too (from package geo), so the
// website never has to look them up.
type Location struct {
	CountryCode string  `json:"countryCode"`
	CountryName string  `json:"countryName"`
	StateCode   *string `json:"stateCode"`
	StateName   *string `json:"stateName"`
	CityName    *string `json:"cityName"`
}

// MostSpecificName is the narrowest part that was picked, which is what gets matched.
func (l Location) MostSpecificName() string {
	if l.CityName != nil {
		return *l.CityName
	}
	if l.StateName != nil {
		return *l.StateName
	}
	return l.CountryName
}

// Label is how a test job's location reads, e.g. "Bangalore, Karnataka, India".
func (l Location) Label() string {
	var parts []string
	for _, part := range []*string{l.CityName, l.StateName, &l.CountryName} {
		if part != nil {
			parts = append(parts, *part)
		}
	}
	return strings.Join(parts, ", ")
}

// key identifies the place, to compare lists of places.
func (l Location) key() string {
	return l.CountryCode + "/" + deref(l.StateCode) + "/" + deref(l.CityName)
}

// Settings are what a user picks on the preferences form. A nil or empty
// setting means "any".
type Settings struct {
	RoleFamily       *string
	RoleLevel        *string
	YearsExperience  *int
	ToleranceYears   *int
	Locations        []Location
	WorkModes        []WorkMode
	OpportunityTypes []OpportunityType
}

// Preferences is what kind of job a user wants. The three lists are stored
// in their own small tables (one row per item).
type Preferences struct {
	ID     string
	UserID string
	Settings
	// When the settings last changed; the preferences page shows it.
	EffectiveSince time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Update replaces every setting (the form always sends all of them).
func (p *Preferences) Update(s Settings, now time.Time) {
	isNew := p.CreatedAt.IsZero()
	changed := isNew ||
		!samePtr(p.RoleFamily, s.RoleFamily) || !samePtr(p.RoleLevel, s.RoleLevel) ||
		!samePtr(p.YearsExperience, s.YearsExperience) || !samePtr(p.ToleranceYears, s.ToleranceYears) ||
		!sameItems(locationKeys(p.Locations), locationKeys(s.Locations)) ||
		!sameItems(p.WorkModes, s.WorkModes) || !sameItems(p.OpportunityTypes, s.OpportunityTypes)

	p.Settings = s
	if changed {
		p.EffectiveSince = now
	}
	if isNew {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
}

// Subscription is a user watching a company: its new jobs that match the
// user's preferences get emailed to them. Unwatching deletes the row.
type Subscription struct {
	ID        string
	UserID    string
	CreatedAt time.Time
	Company   Company
}

// MaxAttempts is how often an email is tried before it's marked FAILED.
const MaxAttempts = 3

// Notification is one "a new job matches you" email for one user. It's
// queued when the job is found and sent a few seconds later (package
// notify), so a slow email provider never holds up the job sync.
type Notification struct {
	ID        string
	Status    NotificationStatus
	Attempts  int
	LastError *string
	CreatedAt time.Time
	SentAt    *time.Time
	User      User
	Job       Job
}

func (n *Notification) MarkSent(now time.Time) {
	n.Attempts++
	n.Status = ProviderAccepted
	n.SentAt = &now
}

// MarkSkipped: something changed since it was queued (see notify's reasonNotToSend).
func (n *Notification) MarkSkipped(reason string) {
	n.Status = Skipped
	n.LastError = &reason
}

// MarkFailedAttempt leaves it QUEUED, so the next round tries again, until MaxAttempts.
func (n *Notification) MarkFailedAttempt(err string) {
	n.Attempts++
	n.LastError = &err
	if n.Attempts >= MaxAttempts {
		n.Status = Failed
	}
}

// TestJob is a fake opening an admin writes for a TEST company. Once
// published, the test board lists it like a real job board would, so it
// goes through the real sync, matching and email: a live demo of the whole flow.
type TestJob struct {
	ID              string
	CompanyID       string
	Title           string
	RoleFamily      string
	Level           *string
	WorkMode        *WorkMode
	OpportunityType OpportunityType
	ExperienceMin   *int
	ExperienceMax   *int
	Description     *string
	ApplicationURL  string
	PublishedAt     *time.Time
	CreatedAt       time.Time
	Locations       []Location
}

// LocationLabel is how the job's location reads on the website:
// "Bangalore, Karnataka, India; Pune, ...", or nil without any.
func (t TestJob) LocationLabel() *string {
	if len(t.Locations) == 0 {
		return nil
	}
	labels := make([]string, len(t.Locations))
	for i, location := range t.Locations {
		labels[i] = location.Label()
	}
	label := strings.Join(labels, "; ")
	return &label
}

// ---- Comparing values.

// samePtr: both nil, or both set to equal values.
func samePtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

// sameTime compares instants: == on time.Time also compares time zones.
func sameTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

// sameItems: the same values, ignoring order and repeats.
func sameItems[T comparable](a, b []T) bool {
	for _, item := range a {
		if !slices.Contains(b, item) {
			return false
		}
	}
	for _, item := range b {
		if !slices.Contains(a, item) {
			return false
		}
	}
	return true
}

func locationKeys(locations []Location) []string {
	keys := make([]string, len(locations))
	for i, location := range locations {
		keys[i] = location.key()
	}
	return keys
}

func deref(text *string) string {
	if text == nil {
		return ""
	}
	return *text
}
