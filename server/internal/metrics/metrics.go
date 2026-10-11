// Package metrics defines the numbers the app reports to Prometheus, which
// the Grafana dashboard (monitoring/ at the repository root) draws. They
// are served at /metrics, on a port of their own (see main.go).
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "API requests, by route, method and status code.",
	}, []string{"route", "method", "status"})

	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "How long API requests take, by route and method.",
		Buckets: prometheus.DefBuckets,
	}, []string{"route", "method"})

	SyncRoundDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Name:    "jobdrop_sync_round_duration_seconds",
		Help:    "How long one pass over every company's board takes.",
		Buckets: []float64{10, 30, 60, 120, 180, 240, 300, 450, 600, 900},
	})

	SyncLastSuccess = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "jobdrop_sync_last_success_timestamp_seconds",
		Help: "When the last sync round finished, as a Unix time.",
	})

	BoardFetchDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "jobdrop_board_fetch_duration_seconds",
		Help:    "How long reading one company's board takes, by platform.",
		Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 90},
	}, []string{"platform"})

	BoardFetchFailures = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "jobdrop_board_fetch_failures_total",
		Help: "Company syncs that failed, by company slug.",
	}, []string{"company"})

	JobChanges = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "jobdrop_job_changes_total",
		Help: "Jobs the sync created, updated, reopened or closed.",
	}, []string{"change"})

	OpenJobs = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "jobdrop_open_jobs",
		Help: "Open jobs across all companies, as of the last sync round.",
	})

	Emails = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "jobdrop_emails_total",
		Help: "Job alert emails by outcome: queued, sent, failed_attempt, failed or skipped.",
	}, []string{"outcome"})

	EmailQueueDepth = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "jobdrop_email_queue_depth",
		Help: "Emails waiting to be sent, as of the last send round.",
	})
)

// Middleware records each request's route, status code and duration. The
// route is the pattern that matched ("GET /api/jobs/{id}"), so every job id
// doesn't become a series of its own.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)

		route := r.Pattern
		if route == "" {
			route = "unrouted" // a CORS preflight, answered before routing
		}
		httpRequests.WithLabelValues(route, r.Method, strconv.Itoa(recorder.status)).Inc()
		httpDuration.WithLabelValues(route, r.Method).Observe(time.Since(start).Seconds())
	})
}

// statusRecorder remembers the status code a handler sent.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// WatchPool reports the database connection pool's state at every scrape.
func WatchPool(pool *pgxpool.Pool) {
	gauge := func(name, help string, read func(*pgxpool.Stat) int32) {
		promauto.NewGaugeFunc(prometheus.GaugeOpts{Name: name, Help: help}, func() float64 {
			return float64(read(pool.Stat()))
		})
	}
	gauge("db_pool_acquired_connections", "Database connections in use.", (*pgxpool.Stat).AcquiredConns)
	gauge("db_pool_idle_connections", "Open database connections not in use.", (*pgxpool.Stat).IdleConns)
	gauge("db_pool_max_connections", "The most connections the pool opens.", (*pgxpool.Stat).MaxConns)
}
