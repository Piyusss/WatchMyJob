// Package api is the REST API the website calls: the routes, who may call
// them, JSON in and out, and a handler per endpoint (grouped in a file per
// area of the site).
package api

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"jobdrop/internal/clerk"
	"jobdrop/internal/config"
	"jobdrop/internal/metrics"
	"jobdrop/internal/model"
	"jobdrop/internal/store"
	"jobdrop/internal/syncer"
)

// Clerk is what the API needs from Clerk: package clerk in the app, a fake
// in the tests.
type Clerk interface {
	VerifyToken(ctx context.Context, token string) (clerkUserID string, err error)
	Profile(ctx context.Context, clerkUserID string) (clerk.Profile, error)
	DeleteUser(ctx context.Context, clerkUserID string) error
}

type Server struct {
	db     *store.DB
	clerk  Clerk
	syncer *syncer.Syncer
	config config.Config
}

// New returns the API's handler: every route, behind the CORS check and
// the metrics recorder.
func New(db *store.DB, clerk Clerk, syncer *syncer.Syncer, config config.Config) http.Handler {
	s := &Server{db: db, clerk: clerk, syncer: syncer, config: config}
	mux := http.NewServeMux()

	// Public: no sign-in needed.
	mux.Handle("GET /health", handler(s.health))
	mux.Handle("GET /api/companies", handler(s.listCompanies))
	mux.Handle("GET /api/locations", handler(s.locations))
	mux.Handle("GET /api/jobs/role-families", handler(s.roleFamilies))
	mux.Handle("POST /api/notifications/unsubscribe", handler(s.unsubscribe)) // the link in every email

	// Signed in.
	mux.Handle("GET /api/auth/me", s.signedIn(s.me))
	mux.Handle("PATCH /api/account/notifications", s.signedIn(s.setPaused))
	mux.Handle("GET /api/account/export", s.signedIn(s.exportAccount))
	mux.Handle("DELETE /api/account", s.signedIn(s.deleteAccount))
	mux.Handle("GET /api/companies/{slug}", s.signedIn(s.companyDetail))
	mux.Handle("GET /api/subscriptions", s.signedIn(s.listSubscriptions))
	mux.Handle("POST /api/subscriptions", s.signedIn(s.watch))
	mux.Handle("DELETE /api/subscriptions/{slug}", s.signedIn(s.unwatch))
	mux.Handle("GET /api/jobs", s.signedIn(s.listJobs))
	mux.Handle("GET /api/jobs/{id}", s.signedIn(s.jobDetail))
	mux.Handle("PUT /api/jobs/{id}/state", s.signedIn(s.setMark))
	mux.Handle("DELETE /api/jobs/{id}/state", s.signedIn(s.clearMark))
	mux.Handle("GET /api/preferences", s.signedIn(s.getPreferences))
	mux.Handle("PUT /api/preferences", s.signedIn(s.savePreferences))
	mux.Handle("GET /api/notifications", s.signedIn(s.alertHistory))

	// Admins only: the accounts on ADMIN_EMAILS.
	mux.Handle("GET /api/admin/test-companies", s.admin(s.listTestCompanies))
	mux.Handle("POST /api/admin/test-companies", s.admin(s.createTestCompany))
	mux.Handle("GET /api/admin/test-companies/{slug}", s.admin(s.testCompanyDetail))
	mux.Handle("PATCH /api/admin/test-companies/{slug}", s.admin(s.setTestCompanyStatus))
	mux.Handle("POST /api/admin/test-companies/{slug}/jobs", s.admin(s.createTestJob))
	mux.Handle("PATCH /api/admin/test-jobs/{id}", s.admin(s.updateTestJob))
	mux.Handle("POST /api/admin/test-jobs/{id}/publish", s.admin(s.publishTestJob))

	// For a hosted Grafana: only with METRICS_TOKEN set, and only for that token.
	if config.MetricsToken != "" {
		mux.Handle("GET /metrics", metricsFor(config.MetricsToken))
	}

	// Any other route, or another method on one of the above.
	mux.Handle("/", handler(func(http.ResponseWriter, *http.Request) error { return notFound("Not found") }))

	return metrics.Middleware(cors(config.FrontendURL, mux))
}

// handler is an endpoint that returns its failure rather than writing it:
// ServeHTTP sends that as the JSON error the website reads. A panic is
// logged and becomes a 500 too, like any other bug.
type handler func(w http.ResponseWriter, r *http.Request) error

func (h handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if p := recover(); p != nil {
			slog.Error("Request failed", "panic", p, "stack", string(debug.Stack()))
			writeError(w, &apiError{status: http.StatusInternalServerError, message: "Something went wrong"})
		}
	}()
	if err := h(w, r); err != nil {
		writeError(w, err)
	}
}

// userHandler is an endpoint for signed-in users: it also gets the user
// making the request.
type userHandler func(w http.ResponseWriter, r *http.Request, user model.User) error

// signedIn requires a valid Clerk session token in the Authorization
// header. Its subject is the Clerk user id, which is the user's id here
// too; a user's item is created on their first request.
func (s *Server) signedIn(h userHandler) handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		user, err := s.currentUser(r)
		if err != nil {
			return err
		}
		return h(w, r, user)
	}
}

func (s *Server) admin(h userHandler) handler {
	return s.signedIn(func(w http.ResponseWriter, r *http.Request, user model.User) error {
		if !s.config.IsAdmin(user.Email) {
			return errNotAdmin
		}
		return h(w, r, user)
	})
}

func (s *Server) currentUser(r *http.Request) (model.User, error) {
	token, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !found || token == "" {
		return model.User{}, errNotSignedIn
	}
	clerkUserID, err := s.clerk.VerifyToken(r.Context(), token)
	if err != nil {
		return model.User{}, errNotSignedIn
	}
	user, err := store.UserByID(r.Context(), s.db, clerkUserID)
	if err != nil {
		return model.User{}, err
	}
	if user != nil {
		return *user, nil
	}
	profile, err := s.clerk.Profile(r.Context(), clerkUserID)
	if err != nil {
		return model.User{}, err
	}
	return store.CreateUser(r.Context(), s.db, clerkUserID, profile.Name, profile.Email, profile.EmailVerified)
}

// cors lets the website's own origin, and no other, call the API from a
// browser. The token travels in the Authorization header, not a cookie.
func cors(frontendURL string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") == frontendURL {
			header := w.Header()
			header.Set("Access-Control-Allow-Origin", frontendURL)
			header.Set("Access-Control-Allow-Credentials", "true")
			header.Add("Vary", "Origin")
			// A preflight: the browser asking first, before a request that
			// carries a token or a JSON body.
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				header.Set("Access-Control-Max-Age", "1800")
				w.WriteHeader(http.StatusOK)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// metricsFor serves the Prometheus metrics on the public API port, which is
// the only port Render exposes, so Grafana Cloud can read them every minute.
// The numbers aren't secret, but they aren't public either: the caller must
// send the token. (Reading them touches no database.)
func metricsFor(token string) http.Handler {
	prometheus := promhttp.Handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		given, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		// Constant-time, so the comparison's timing doesn't reveal the token.
		if subtle.ConstantTimeCompare([]byte(given), []byte(token)) != 1 {
			writeError(w, errNotSignedIn)
			return
		}
		prometheus.ServeHTTP(w, r)
	})
}

// health is for the hosting platform's health check (Render calls it every
// 5 seconds) and uptime monitors: is the server up and answering? It
// deliberately leaves the database alone. Checked that often, it would use
// up read capacity the website needs, and a short database blip would get
// a healthy server restarted. The server can't start without its database
// anyway: startup checks for the table first.
func (s *Server) health(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	return nil
}
