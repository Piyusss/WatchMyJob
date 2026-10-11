package boards

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"jobdrop/internal/matching"
	"jobdrop/internal/model"
)

// Ashby's public job board API (the one behind companies' own careers
// pages). One request returns every open job.
type Ashby struct {
	client  *http.Client
	baseURL string
}

var ashbyWorkplaces = map[string]model.WorkMode{
	"remote": model.Remote,
	"hybrid": model.Hybrid,
	"onsite": model.OnSite,
}

var ashbyEmploymentTypes = map[string]model.OpportunityType{
	"fulltime":  model.FullTime,
	"parttime":  model.PartTime,
	"intern":    model.Internship,
	"contract":  model.Contract,
	"temporary": model.OtherType,
}

type ashbyPlace struct {
	Location *string `json:"location"`
}

func (a Ashby) Fetch(ctx context.Context, company model.Company, etag string) ([]model.Posting, string, error) {
	var response struct {
		Jobs []struct {
			ID                 string       `json:"id"`
			Title              string       `json:"title"`
			Location           *string      `json:"location"`
			SecondaryLocations []ashbyPlace `json:"secondaryLocations"`
			EmploymentType     *string      `json:"employmentType"`
			WorkplaceType      *string      `json:"workplaceType"`
			PublishedAt        *time.Time   `json:"publishedAt"`
			IsListed           *bool        `json:"isListed"`
			DescriptionPlain   *string      `json:"descriptionPlain"`
			DescriptionHTML    string       `json:"descriptionHtml"`
			JobURL             string       `json:"jobUrl"`
		} `json:"jobs"`
	}
	address := a.baseURL + "/posting-api/job-board/" + url.PathEscape(company.BoardID)
	tag, err := getJSON(ctx, a.client, address, etag, &response)
	if err != nil {
		return nil, "", err
	}

	postings := make([]model.Posting, 0, len(response.Jobs))
	for _, job := range response.Jobs {
		if job.IsListed != nil && !*job.IsListed {
			continue // taken off the board
		}
		title := matching.Strip(job.Title)
		// The plain-text description when there is one, else the HTML one.
		employmentType := lookup(ashbyEmploymentTypes, job.EmploymentType)
		var class model.Classification
		if job.DescriptionPlain != nil {
			class = matching.ClassifyText(title, *job.DescriptionPlain, employmentType)
		} else {
			class = matching.ClassifyHTML(title, job.DescriptionHTML, employmentType)
		}
		postings = append(postings, model.Posting{
			ExternalID:     job.ID,
			Title:          title,
			Location:       allPlaces(job.Location, job.SecondaryLocations),
			WorkMode:       lookup(ashbyWorkplaces, job.WorkplaceType),
			URL:            job.JobURL,
			PostedAt:       job.PublishedAt,
			Classification: class,
		})
	}
	return postings, tag, nil
}

// allPlaces is the main location plus any others, each once, so a job open
// in both Bangalore and Singapore matches users in either.
func allPlaces(main *string, others []ashbyPlace) *string {
	places := []*string{main}
	for _, other := range others {
		places = append(places, other.Location)
	}
	var unique []string
	for _, place := range places {
		if cleaned := clean(place); cleaned != nil && !slices.Contains(unique, *cleaned) {
			unique = append(unique, *cleaned)
		}
	}
	if len(unique) == 0 {
		return nil
	}
	joined := strings.Join(unique, ", ")
	return &joined
}
