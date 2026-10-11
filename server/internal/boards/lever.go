package boards

import (
	"context"
	"net/http"
	"net/url"
	"time"

	"jobdrop/internal/matching"
	"jobdrop/internal/model"
)

// Lever's public postings API (the one behind companies' own careers
// pages). One request returns every open job.
type Lever struct {
	client  *http.Client
	baseURL string
}

var leverWorkplaces = map[string]model.WorkMode{
	"remote": model.Remote,
	"hybrid": model.Hybrid,
	"onsite": model.OnSite,
}

var leverCommitments = map[string]model.OpportunityType{
	"full-time":  model.FullTime,
	"internship": model.Internship,
	"contractor": model.Contract,
	"part-time":  model.PartTime,
	"fixed-term": model.OtherType,
}

func (l Lever) Fetch(ctx context.Context, company model.Company, etag string) ([]model.Posting, string, error) {
	var response []struct {
		ID         string `json:"id"`
		Text       string `json:"text"`
		Categories *struct {
			Location   *string `json:"location"`
			Commitment *string `json:"commitment"`
		} `json:"categories"`
		HostedURL     string  `json:"hostedUrl"`
		CreatedAt     *int64  `json:"createdAt"` // milliseconds since 1970
		WorkplaceType *string `json:"workplaceType"`
		Description   string  `json:"description"`
	}
	address := l.baseURL + "/v0/postings/" + url.PathEscape(company.BoardID) + "?mode=json"
	tag, err := getJSON(ctx, l.client, address, etag, &response)
	if err != nil {
		return nil, "", err
	}

	postings := make([]model.Posting, 0, len(response))
	for _, job := range response {
		title := matching.Strip(job.Text)
		var location, commitment *string
		if job.Categories != nil {
			location = clean(job.Categories.Location)
			commitment = job.Categories.Commitment
		}
		var postedAt *time.Time
		if job.CreatedAt != nil {
			created := time.UnixMilli(*job.CreatedAt).UTC()
			postedAt = &created
		}
		postings = append(postings, model.Posting{
			ExternalID:     job.ID,
			Title:          title,
			Location:       location,
			WorkMode:       lookup(leverWorkplaces, job.WorkplaceType),
			URL:            job.HostedURL,
			PostedAt:       postedAt,
			Classification: matching.ClassifyHTML(title, job.Description, lookup(leverCommitments, commitment)),
		})
	}
	return postings, tag, nil
}
