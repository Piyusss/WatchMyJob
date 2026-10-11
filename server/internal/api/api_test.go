package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"jobdrop/internal/boards"
	"jobdrop/internal/clerk"
	"jobdrop/internal/config"
	"jobdrop/internal/notify"
	"jobdrop/internal/syncer"
	"jobdrop/internal/testdb"
)

// The REST API as the website uses it, against a real (Docker) database.

func TestMain(m *testing.M) {
	testdb.Run(m)
}

// fakeClerk takes the token "<Clerk user id>" as a valid one for that user,
// and knows the profiles the tests give it.
type fakeClerk map[string]clerk.Profile

func (f fakeClerk) VerifyToken(_ context.Context, token string) (string, error) {
	return token, nil
}

func (f fakeClerk) Profile(_ context.Context, clerkUserID string) (clerk.Profile, error) {
	profile, ok := f[clerkUserID]
	if !ok {
		return clerk.Profile{}, errors.New("no such Clerk user")
	}
	return profile, nil
}

func (f fakeClerk) DeleteUser(context.Context, string) error {
	return nil
}

var clerkUsers = fakeClerk{}

// newAPI is the app's API on the test database. The website is at
// localhost:3000, and admin@example.com is an admin.
func newAPI() http.Handler {
	return New(testdb.Pool, clerkUsers, syncer.New(testdb.Pool, boards.All(nil, testdb.Pool), nil), config.Config{
		FrontendURL: "http://localhost:3000",
		AdminEmails: []string{"admin@example.com"},
	})
}

// call sends a request, as the user with that Clerk id ("" for signed
// out), and returns the status code and the decoded JSON body.
func call(t *testing.T, method, path, clerkUserID, body string) (int, any) {
	t.Helper()
	return callWith(t, newAPI(), method, path, clerkUserID, body)
}

func callWith(t *testing.T, api http.Handler, method, path, clerkUserID, body string) (int, any) {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if clerkUserID != "" {
		request.Header.Set("Authorization", "Bearer "+clerkUserID)
	}
	response := httptest.NewRecorder()
	api.ServeHTTP(response, request)

	var decoded any
	if response.Body.Len() > 0 {
		if err := json.Unmarshal(response.Body.Bytes(), &decoded); err != nil {
			t.Fatalf("%s %s: not JSON: %s", method, path, response.Body)
		}
	}
	return response.Code, decoded
}

// field reads a value out of a decoded JSON body, following keys and list indexes.
func field(body any, path ...any) any {
	for _, step := range path {
		switch key := step.(type) {
		case string:
			object, _ := body.(map[string]any)
			body = object[key]
		case int:
			list, _ := body.([]any)
			if key >= len(list) {
				return nil
			}
			body = list[key]
		}
	}
	return body
}

func expect(t *testing.T, what string, got, want any) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", what, got, want)
	}
}

func TestRequestsWithoutATokenAreRejected(t *testing.T) {
	status, body := call(t, "GET", "/api/auth/me", "", "")
	expect(t, "status", status, 401)
	expect(t, "error", field(body, "error"), "Not authenticated")
}

func TestANewUsersFirstRequestCreatesThemFromTheirClerkProfile(t *testing.T) {
	clerkUserID := testdb.Unique("user")
	clerkUsers[clerkUserID] = clerk.Profile{Name: "Ada Lovelace", Email: "ada@example.com", EmailVerified: true}

	status, body := call(t, "GET", "/api/auth/me", clerkUserID, "")
	expect(t, "status", status, 200)
	expect(t, "name", field(body, "user", "name"), "Ada Lovelace")
	expect(t, "hasPreferences", field(body, "user", "hasPreferences"), false)
	expect(t, "isAdmin", field(body, "user", "isAdmin"), false)
}

func TestBadPreferencesAreRejectedFieldByField(t *testing.T) {
	user := testdb.User(t, testdb.Unique("picky")+"@example.com")

	status, body := call(t, "PUT", "/api/preferences", user.ClerkUserID, `{"roleLevel":"Wizard","yearsExperience":99}`)
	expect(t, "status", status, 400)
	expect(t, "error", field(body, "error"), "Invalid input")
	expect(t, "roleLevel problem", field(body, "details", "roleLevel", 0),
		`must match "Intern|Associate|Senior|Lead|Staff|Principal"`)
	expect(t, "yearsExperience problem", field(body, "details", "yearsExperience", 0), "must be less than or equal to 60")

	status, body = call(t, "PUT", "/api/preferences", user.ClerkUserID, `{"locations":[{"countryCode":"XX"}]}`)
	expect(t, "status", status, 400)
	expect(t, "locations problem", field(body, "details", "locations", 0), "Unknown country")
}

func TestTheFeedShowsMatchingJobsAtWatchedCompaniesAndDismissingHidesOne(t *testing.T) {
	user := testdb.User(t, testdb.Unique("seeker")+"@example.com")
	company := testdb.WatchableCompany(t)
	match := testdb.OpenJob(t, company, "Backend Engineer")
	testdb.OpenJob(t, company, "Product Designer")

	status, _ := call(t, "POST", "/api/subscriptions", user.ClerkUserID, `{"companySlug":"`+company.Slug+`"}`)
	expect(t, "watch status", status, 201)
	status, body := call(t, "PUT", "/api/preferences", user.ClerkUserID, `{"roleFamily":"Backend Engineer"}`)
	expect(t, "preferences status", status, 200)
	expect(t, "saved role", field(body, "preferences", "roleFamily"), "Backend Engineer")

	_, body = call(t, "GET", "/api/jobs", user.ClerkUserID, "")
	expect(t, "unfilteredTotal", field(body, "unfilteredTotal"), 2.0)
	expect(t, "total", field(body, "total"), 1.0)
	expect(t, "filtered", field(body, "filtered"), true)
	expect(t, "first title", field(body, "jobs", 0, "title"), "Backend Engineer")
	expect(t, "overallMatch", field(body, "jobs", 0, "matchExplanation", "overallMatch"), true)

	_, body = call(t, "PUT", "/api/jobs/"+match.ID+"/state", user.ClerkUserID, `{"state":"DISMISSED"}`)
	expect(t, "state", field(body, "state"), "DISMISSED")
	_, body = call(t, "GET", "/api/jobs", user.ClerkUserID, "")
	expect(t, "total after dismissing", field(body, "total"), 0.0)
	_, body = call(t, "GET", "/api/jobs?state=DISMISSED", user.ClerkUserID, "")
	expect(t, "dismissed job", field(body, "jobs", 0, "id"), match.ID)
}

func TestAdminPagesAreForAdminsOnly(t *testing.T) {
	user := testdb.User(t, testdb.Unique("not-admin")+"@example.com")
	status, body := call(t, "GET", "/api/admin/test-companies", user.ClerkUserID, "")
	expect(t, "status", status, 403)
	expect(t, "error", field(body, "error"), "Admin access required")
}

func TestPublishingATestJobQueuesAnEmailForAMatchingWatcher(t *testing.T) {
	admin := testdb.User(t, "admin@example.com") // on ADMIN_EMAILS
	fan := testdb.User(t, testdb.Unique("fan")+"@example.com")
	testdb.OpenJob(t, testdb.WatchableCompany(t), "Data Engineer") // a role must exist on a real open job to be picked

	status, body := call(t, "POST", "/api/admin/test-companies", admin.ClerkUserID, `{"name":"`+testdb.Unique("Demo Corp")+`"}`)
	expect(t, "create status", status, 201)
	slug, _ := field(body, "company", "slug").(string)

	status, _ = call(t, "POST", "/api/subscriptions", fan.ClerkUserID, `{"companySlug":"`+slug+`"}`)
	expect(t, "watch status", status, 201)
	status, _ = call(t, "PUT", "/api/preferences", fan.ClerkUserID, `{"roleFamily":"Data Engineer"}`)
	expect(t, "preferences status", status, 200)

	status, body = call(t, "POST", "/api/admin/test-companies/"+slug+"/jobs", admin.ClerkUserID,
		`{"title":"Data Engineer","roleFamily":"Data Engineer","applicationUrl":"https://example.com/apply",
		  "locations":[{"countryCode":"IN","stateCode":"KA","cityName":"Bangalore"}]}`)
	expect(t, "test job status", status, 201)
	expect(t, "published", field(body, "job", "published"), false)
	testJobID, _ := field(body, "job", "id").(string)

	status, body = call(t, "POST", "/api/admin/test-jobs/"+testJobID+"/publish", admin.ClerkUserID, "")
	expect(t, "publish status", status, 200)
	expect(t, "created", field(body, "result", "created"), 1.0)
	expect(t, "queued", field(body, "result", "queued"), 1.0)
	expect(t, "job title", field(body, "job", "title"), "Data Engineer")
	expect(t, "queued notifications", field(body, "notificationsByStatus", "QUEUED"), 1.0)
}

// recordingMailer keeps the emails it's asked to send.
type recordingMailer struct {
	to   []string
	sent []notify.Email
}

func (m *recordingMailer) Send(_ context.Context, to string, email notify.Email) error {
	m.to = append(m.to, to)
	m.sent = append(m.sent, email)
	return nil
}

// The interview demo, end to end, wired as main.go wires it: the admin
// publishes a test job, the sync queues an email for the matching watcher
// and wakes the sender, the email goes out, and the watcher's alerts page
// shows it as sent. Publishing it again emails nobody.
func TestTheDemoFromPublishingToTheEmailAndTheAlertsPage(t *testing.T) {
	mailer := &recordingMailer{}
	sender := notify.NewSender(testdb.Pool, mailer, "http://localhost:3000")
	api := New(testdb.Pool, clerkUsers, syncer.New(testdb.Pool, boards.All(nil, testdb.Pool), sender.Wake), config.Config{
		FrontendURL: "http://localhost:3000",
		AdminEmails: []string{"admin@example.com"},
	})
	send := func() {
		t.Helper()
		if err := sender.SendQueued(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	send() // a new sender looks once; after that, only when woken

	admin := testdb.User(t, "admin@example.com")
	fan := testdb.User(t, testdb.Unique("fan")+"@example.com")
	testdb.OpenJob(t, testdb.WatchableCompany(t), "Data Engineer") // a role must exist on a real open job
	company := testdb.Unique("Demo Corp")
	_, body := callWith(t, api, "POST", "/api/admin/test-companies", admin.ClerkUserID, `{"name":"`+company+`"}`)
	slug, _ := field(body, "company", "slug").(string)
	callWith(t, api, "POST", "/api/subscriptions", fan.ClerkUserID, `{"companySlug":"`+slug+`"}`)
	callWith(t, api, "PUT", "/api/preferences", fan.ClerkUserID, `{"roleFamily":"Data Engineer"}`)
	_, body = callWith(t, api, "POST", "/api/admin/test-companies/"+slug+"/jobs", admin.ClerkUserID,
		`{"title":"Data Engineer","roleFamily":"Data Engineer","applicationUrl":"https://example.com/apply"}`)
	testJobID, _ := field(body, "job", "id").(string)

	_, body = callWith(t, api, "POST", "/api/admin/test-jobs/"+testJobID+"/publish", admin.ClerkUserID, "")
	expect(t, "queued", field(body, "result", "queued"), 1.0)
	send()
	sentTo := -1
	for i, to := range mailer.to {
		if to == fan.Email {
			sentTo = i
		}
	}
	if sentTo < 0 {
		t.Fatalf("no email to %s; sent to %v", fan.Email, mailer.to)
	}
	email := mailer.sent[sentTo]
	expect(t, "subject", email.Subject, "New job match: Data Engineer at "+company)
	for _, link := range []string{"https://example.com/apply", "http://localhost:3000/unsubscribe?token=" + fan.UnsubscribeToken} {
		if !strings.Contains(email.HTML, link) || !strings.Contains(email.Text, link) {
			t.Errorf("the email should link to %s", link)
		}
	}

	_, body = callWith(t, api, "GET", "/api/notifications", fan.ClerkUserID, "")
	expect(t, "alert status", field(body, "notifications", 0, "status"), "PROVIDER_ACCEPTED")
	expect(t, "alert job", field(body, "notifications", 0, "job", "title"), "Data Engineer")

	_, body = callWith(t, api, "POST", "/api/admin/test-jobs/"+testJobID+"/publish", admin.ClerkUserID, "")
	expect(t, "created again", field(body, "result", "created"), 0.0)
	expect(t, "queued again", field(body, "result", "queued"), 0.0)
}

// ---- The website relies on these details of the JSON, beyond the Java tests.

func TestEmptyListsAreEmptyArraysNotNull(t *testing.T) {
	user := testdb.User(t, testdb.Unique("newcomer")+"@example.com")
	for path, key := range map[string]string{
		"/api/subscriptions":  "subscriptions",
		"/api/jobs":           "jobs",
		"/api/notifications":  "notifications",
		"/api/account/export": "subscriptions",
	} {
		_, body := call(t, "GET", path, user.ClerkUserID, "")
		if list, ok := field(body, key).([]any); !ok || len(list) != 0 {
			t.Errorf("%s: %s is %v, want []", path, key, field(body, key))
		}
	}
	_, body := call(t, "PUT", "/api/preferences", user.ClerkUserID, `{}`)
	for _, key := range []string{"locations", "workMode", "opportunityTypes"} {
		if list, ok := field(body, "preferences", key).([]any); !ok || len(list) != 0 {
			t.Errorf("preferences.%s is %v, want []", key, field(body, "preferences", key))
		}
	}
}

func TestErrorsKeepTheJSONShape(t *testing.T) {
	user := testdb.User(t, testdb.Unique("lost")+"@example.com")
	cases := []struct {
		method, path, body string
		status             int
		message            string
	}{
		{"GET", "/api/no-such-thing", "", 404, "Not found"},
		{"POST", "/api/companies", "", 404, "Not found"}, // a known route, another method
		{"GET", "/api/jobs/not-a-uuid", "", 400, "Invalid input"},
		{"GET", "/api/jobs/00000000-0000-0000-0000-000000000000", "", 404, "Job not found"},
		{"PUT", "/api/preferences", "{not json", 400, "Invalid input"},
		{"PUT", "/api/preferences", `{"workMode":["ON_THE_MOON"]}`, 400, "Invalid input"},
		{"POST", "/api/subscriptions", `{"companySlug":"no-such-company"}`, 404, "No such company"},
	}
	for _, c := range cases {
		status, body := call(t, c.method, c.path, user.ClerkUserID, c.body)
		if status != c.status || field(body, "error") != c.message {
			t.Errorf("%s %s: got %d %v, want %d %q", c.method, c.path, status, body, c.status, c.message)
		}
	}
}

func TestAJobPageHasNoDescriptionAndNamesItsCompany(t *testing.T) {
	user := testdb.User(t, testdb.Unique("reader")+"@example.com")
	company := testdb.WatchableCompany(t)
	job := testdb.OpenJob(t, company, "Backend Engineer")

	status, body := call(t, "GET", "/api/jobs/"+job.ID, user.ClerkUserID, "")
	expect(t, "status", status, 200)
	expect(t, "description", field(body, "job", "description"), "")
	expect(t, "company id", field(body, "job", "company", "id"), company.ID)
	expect(t, "user state", field(body, "job", "userState"), nil)
	expect(t, "experience status", field(body, "job", "experienceStatus"), "UNKNOWN")
}

// /metrics is on the public port only when METRICS_TOKEN is set, and only
// for a caller with that token (Grafana Cloud).
func TestMetricsAreOnlyPublicWithTheToken(t *testing.T) {
	withToken := New(testdb.Pool, clerkUsers, syncer.New(testdb.Pool, boards.All(nil, testdb.Pool), nil), config.Config{
		FrontendURL: "http://localhost:3000", MetricsToken: "s3cret",
	})
	for _, c := range []struct {
		api           http.Handler
		authorization string
		want          int
	}{
		{newAPI(), "Bearer s3cret", http.StatusNotFound}, // no METRICS_TOKEN: no public route
		{withToken, "", http.StatusUnauthorized},
		{withToken, "Bearer wrong", http.StatusUnauthorized},
		{withToken, "Bearer s3cret", http.StatusOK},
	} {
		request := httptest.NewRequest("GET", "/metrics", nil)
		if c.authorization != "" {
			request.Header.Set("Authorization", c.authorization)
		}
		response := httptest.NewRecorder()
		c.api.ServeHTTP(response, request)
		if response.Code != c.want {
			t.Errorf("%q: got %d, want %d", c.authorization, response.Code, c.want)
		}
		if c.want == http.StatusOK && !strings.Contains(response.Body.String(), "go_goroutines") {
			t.Error("the metrics should be in Prometheus' text format")
		}
	}
}

// The health check answers without the database (see health in server.go).
func TestTheHealthCheckSaysTheServerIsUp(t *testing.T) {
	status, body := call(t, "GET", "/health", "", "")
	if status != 200 || body.(map[string]any)["status"] != "ok" {
		t.Errorf("got %d %v", status, body)
	}
}

func TestOnlyTheWebsiteGetsCORSHeaders(t *testing.T) {
	for origin, allowed := range map[string]bool{"http://localhost:3000": true, "https://evil.example": false} {
		request := httptest.NewRequest("OPTIONS", "/api/jobs", nil)
		request.Header.Set("Origin", origin)
		request.Header.Set("Access-Control-Request-Method", "GET")
		response := httptest.NewRecorder()
		newAPI().ServeHTTP(response, request)
		if got := response.Header().Get("Access-Control-Allow-Origin") == origin; got != allowed {
			t.Errorf("%s: allowed %v, want %v (status %d)", origin, got, allowed, response.Code)
		}
	}
}

func TestUnsubscribingPausesAlertsWithoutSigningIn(t *testing.T) {
	user := testdb.User(t, testdb.Unique("done")+"@example.com")
	status, body := call(t, "POST", "/api/notifications/unsubscribe", "", `{"token":"`+user.UnsubscribeToken+`"}`)
	expect(t, "status", status, 200)
	expect(t, "paused", field(body, "notificationsPaused"), true)

	status, body = call(t, "POST", "/api/notifications/unsubscribe", "", `{"token":"made-up"}`)
	expect(t, "unknown token status", status, 404)
	expect(t, "error", field(body, "error"), "This unsubscribe link is invalid")
}
