package notify

import (
	"bytes"
	_ "embed"
	"html/template"
	"strings"

	"jobdrop/internal/model"
)

// Email is one email, as HTML plus a plain-text copy.
type Email struct {
	Subject string
	HTML    string
	Text    string
}

// The HTML layout of the job alert. It uses tables and inline styles on
// purpose, because many email clients (Outlook especially) ignore CSS.
// html/template escapes every value put into it.
//
//go:embed job-alert.html
var jobAlertHTML string

var jobAlertTemplate = template.Must(template.New("job-alert").Parse(jobAlertHTML))

var workModeNames = map[model.WorkMode]string{
	model.Remote: "Remote",
	model.Hybrid: "Hybrid",
	model.OnSite: "On-site",
}

var opportunityTypeNames = map[model.OpportunityType]string{
	model.FullTime:   "Full-time",
	model.Internship: "Internship",
	model.Contract:   "Contract",
	model.PartTime:   "Part-time",
	model.OtherType:  "Other",
}

type detail struct {
	Label string
	Value string
}

// JobAlert is the "new job match" email: the job's details, a "View job"
// button and an unsubscribe link.
func JobAlert(user model.User, job model.Job, unsubscribeURL string) (Email, error) {
	company := job.Company.Name
	role := job.Title
	if job.RoleFamily != nil {
		role = *job.RoleFamily
	}

	// Only the details the posting actually has.
	details := []detail{{"Company", company}, {"Role", role}}
	if job.Level != nil {
		details = append(details, detail{"Level", *job.Level})
	}
	if job.Location != nil {
		details = append(details, detail{"Location", *job.Location})
	}
	if job.WorkMode != nil {
		details = append(details, detail{"Work Mode", workModeNames[*job.WorkMode]})
	}
	details = append(details, detail{"Opportunity Type", opportunityTypeNames[job.OpportunityType]})

	var html bytes.Buffer
	err := jobAlertTemplate.Execute(&html, struct {
		Name, Company          string
		Details                []detail
		JobURL, UnsubscribeURL string
	}{user.Name, company, details, job.URL, unsubscribeURL})
	if err != nil {
		return Email{}, err
	}

	text := strings.Builder{}
	text.WriteString("WatchmyJob\n\nNew Job Match\n\n")
	for _, d := range details {
		text.WriteString(d.Label + ": " + d.Value + "\n")
	}
	text.WriteString("\nView job: " + job.URL + "\n\n---\nDon't want these emails? Unsubscribe: " + unsubscribeURL)

	return Email{
		Subject: "New job match: " + role + " at " + company,
		HTML:    html.String(),
		Text:    text.String(),
	}, nil
}
