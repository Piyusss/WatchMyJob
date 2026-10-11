package boards

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"jobdrop/internal/model"
)

// Each board reads a real response recorded from that board's API
// (testdata/), served by a local test server instead of the network.
func serve(t *testing.T, path, fixture string) *httptest.Server {
	body, err := os.ReadFile(filepath.Join("testdata", fixture))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RequestURI() != path {
			t.Errorf("unexpected request for %s", r.URL)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	return server
}

func fetch(t *testing.T, board Board, boardID string) []model.Posting {
	postings, _, err := board.Fetch(context.Background(), model.Company{Name: "Acme", BoardID: boardID}, "")
	if err != nil {
		t.Fatal(err)
	}
	return postings
}

func TestGreenhouse(t *testing.T) {
	server := serve(t, "/v1/boards/figma/jobs?content=true", "greenhouse.json")
	jobs := fetch(t, Greenhouse{server.Client(), server.URL}, "figma")

	if len(jobs) != 3 {
		t.Fatalf("got %d jobs, want 3", len(jobs))
	}
	first := jobs[0]
	check(t, "external id", first.ExternalID, "5364702004")
	check(t, "title", first.Title, "Account Executive, Emerging Enterprise (Berlin, Germany)")
	check(t, "location", *first.Location, "Berlin, Germany")
	check(t, "opportunity type", first.OpportunityType, model.FullTime)
	// Sent as 06:05:10-04:00.
	if want := time.Date(2024, 11, 1, 10, 5, 10, 0, time.UTC); !first.PostedAt.Equal(want) {
		t.Errorf("posted at %v, want %v", first.PostedAt, want)
	}
}

func TestLever(t *testing.T) {
	server := serve(t, "/v0/postings/palantir?mode=json", "lever.json")
	jobs := fetch(t, Lever{server.Client(), server.URL}, "palantir")

	if len(jobs) != 3 {
		t.Fatalf("got %d jobs, want 3", len(jobs))
	}
	first := jobs[0]
	check(t, "title", first.Title, "Administrative Business Partner")
	check(t, "location", *first.Location, "London, United Kingdom")
	check(t, "work mode", *first.WorkMode, model.Hybrid)
	check(t, "opportunity type", first.OpportunityType, model.FullTime) // "Full-time"
	if want := time.UnixMilli(1711403416463); !first.PostedAt.Equal(want) {
		t.Errorf("posted at %v, want %v", first.PostedAt, want)
	}
}

func TestAshby(t *testing.T) {
	server := serve(t, "/posting-api/job-board/openai", "ashby.json")
	jobs := fetch(t, Ashby{server.Client(), server.URL}, "openai")

	if len(jobs) != 8 {
		t.Fatalf("got %d jobs, want 8", len(jobs))
	}
	// The main location and the other ones, in one string.
	check(t, "location", *jobs[1].Location, "US - Remote, Seattle, San Francisco")
	check(t, "work mode", *jobs[1].WorkMode, model.Remote)
	check(t, "type of job 5", jobs[5].OpportunityType, model.Internship)
	check(t, "type of job 6", jobs[6].OpportunityType, model.Contract)
	check(t, "type of job 7", jobs[7].OpportunityType, model.OtherType) // "Temporary"
	check(t, "work mode of job 7", *jobs[7].WorkMode, model.OnSite)     // "OnSite"
}

func TestABoardThatAnswersWithAnErrorFailsTheSync(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	t.Cleanup(server.Close)

	_, _, err := Greenhouse{server.Client(), server.URL}.Fetch(context.Background(), model.Company{BoardID: "gone"}, "")
	if err == nil {
		t.Error("a 404 should be an error")
	}
}

// A board sends its version tag (ETag) with every answer. Asked again with
// that tag, it answers "304 Not Modified" with no body while nothing changed.
func TestABoardThatHasNotChangedIsNotReadAgain(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("testdata", "lever.json"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") == `W/"v1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `W/"v1"`)
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	board := Lever{server.Client(), server.URL}
	company := model.Company{BoardID: "palantir"}

	postings, etag, err := board.Fetch(context.Background(), company, "")
	if err != nil || len(postings) != 3 || etag != `W/"v1"` {
		t.Fatalf("first read: %d postings, tag %q, %v", len(postings), etag, err)
	}
	if _, _, err := board.Fetch(context.Background(), company, etag); !errors.Is(err, ErrNotModified) {
		t.Errorf("second read: got %v, want ErrNotModified", err)
	}
}

func check[T comparable](t *testing.T, what string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", what, got, want)
	}
}
