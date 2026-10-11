package boards

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"jobdrop/internal/matching"
	"jobdrop/internal/model"
)

// Greenhouse's public job board API, the one companies use to show their
// openings on their own careers page. One request returns every open job.
type Greenhouse struct {
	client  *http.Client
	baseURL string
}

func (g Greenhouse) Fetch(ctx context.Context, company model.Company, etag string) ([]model.Posting, string, error) {
	// The parts of Greenhouse's response we use.
	var response struct {
		Jobs []struct {
			ID       int64  `json:"id"`
			Title    string `json:"title"`
			URL      string `json:"absolute_url"`
			Location *struct {
				Name *string `json:"name"`
			} `json:"location"`
			Content        string     `json:"content"`
			FirstPublished *time.Time `json:"first_published"`
		} `json:"jobs"`
	}
	address := g.baseURL + "/v1/boards/" + url.PathEscape(company.BoardID) + "/jobs?content=true"
	tag, err := getJSON(ctx, g.client, address, etag, &response)
	if err != nil {
		return nil, "", err
	}

	postings := make([]model.Posting, 0, len(response.Jobs))
	for _, job := range response.Jobs {
		title := matching.Strip(job.Title)
		var location *string
		if job.Location != nil {
			location = clean(job.Location.Name)
		}
		// Greenhouse has no work-mode field; "Remote" in the location is the one reliable signal.
		var workMode *model.WorkMode
		if location != nil && strings.Contains(strings.ToLower(*location), "remote") {
			remote := model.Remote
			workMode = &remote
		}
		postings = append(postings, model.Posting{
			ExternalID:     strconv.FormatInt(job.ID, 10),
			Title:          title,
			Location:       location,
			WorkMode:       workMode,
			URL:            job.URL,
			PostedAt:       job.FirstPublished,
			Classification: matching.ClassifyHTML(title, job.Content, nil),
		})
	}
	return postings, tag, nil
}
