// Package boards reads the job boards companies post their openings on,
// one file per platform. Each turns its board's JSON into model.Postings,
// already classified.
package boards

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"jobdrop/internal/matching"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

// Board is a source of job postings. The syncer only talks to this
// interface, so adding a platform means adding one file.
type Board interface {
	// Fetch returns every job open on the company's board right now, and
	// the board's version tag (its HTTP ETag; "" if it gives none). Given
	// the tag from the last read, it returns ErrNotModified instead when
	// the board hasn't changed since.
	Fetch(ctx context.Context, company model.Company, etag string) ([]model.Posting, string, error)
}

// ErrNotModified is Fetch's answer for a board that is the same as at the
// tag it was given: the board said "304 Not Modified" and sent no body.
var ErrNotModified = errors.New("the board hasn't changed")

// All returns each platform's board. client makes the calls to the boards'
// public APIs; db holds the test companies' published jobs.
func All(client *http.Client, db *store.DB) map[model.Platform]Board {
	return map[model.Platform]Board{
		model.PlatformGreenhouse: Greenhouse{client, "https://boards-api.greenhouse.io"},
		model.PlatformLever:      Lever{client, "https://api.lever.co"},
		model.PlatformAshby:      Ashby{client, "https://api.ashbyhq.com"},
		model.PlatformTest:       Test{db},
	}
}

// getJSON reads url's JSON body into result and returns the response's
// ETag. Given the ETag from last time, it sends it as If-None-Match: the
// board then answers "304 Not Modified", with no body, if nothing changed
// (ErrNotModified). That spares downloading and reading the whole board,
// which is most of a sync's work. Any other answer outside 2xx is an
// error, which fails that company's sync.
func getJSON(ctx context.Context, client *http.Client, url, etag string, result any) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/json")
	if etag != "" {
		request.Header.Set("If-None-Match", etag)
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotModified {
		return "", ErrNotModified
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 200))
		return "", fmt.Errorf("GET %s: %s %s", url, response.Status, body)
	}
	return response.Header.Get("ETag"), json.NewDecoder(response.Body).Decode(result)
}

// clean is trimmed text, or nil when there's nothing there.
func clean(text *string) *string {
	if text == nil || matching.Strip(*text) == "" {
		return nil
	}
	trimmed := matching.Strip(*text)
	return &trimmed
}

// lookup finds a board's own word (any case) in a table of ours, or nil.
func lookup[T any](table map[string]T, word *string) *T {
	if word == nil {
		return nil
	}
	value, ok := table[strings.ToLower(*word)]
	if !ok {
		return nil
	}
	return &value
}
