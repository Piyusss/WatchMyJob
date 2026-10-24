// Package metrics defines the numbers the app reports to Prometheus, which
// the Grafana dashboard (monitoring/ at the repository root) draws. They
// are served at /metrics, on a port of their own (see main.go).
package metrics

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsmiddleware "github.com/aws/aws-sdk-go-v2/aws/middleware"
	"github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/smithy-go/middleware"
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

	dynamoRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "dynamodb_requests_total",
		Help: "DynamoDB requests by operation and outcome (ok, condition_failed or error), after any retries.",
	}, []string{"operation", "outcome"})

	dynamoDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "dynamodb_request_duration_seconds",
		Help:    "How long DynamoDB requests take, retries included, by operation.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
	}, []string{"operation"})

	dynamoThrottles = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "dynamodb_throttled_attempts_total",
		Help: "DynamoDB attempts refused for lack of capacity (then retried), by operation.",
	}, []string{"operation"})
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

// DynamoDB records every request the DynamoDB client makes; db.Connect
// adds it to the client's middleware stack. Initialize is the stack's
// first step, so it sees each request once, retries included.
func DynamoDB(stack *middleware.Stack) error {
	err := stack.Initialize.Add(middleware.InitializeMiddlewareFunc("JobDropMetrics",
		func(ctx context.Context, in middleware.InitializeInput, next middleware.InitializeHandler) (
			middleware.InitializeOutput, middleware.Metadata, error) {
			start := time.Now()
			out, metadata, err := next.HandleInitialize(ctx, in)
			operation := awsmiddleware.GetOperationName(ctx)
			dynamoRequests.WithLabelValues(operation, outcome(err)).Inc()
			dynamoDuration.WithLabelValues(operation).Observe(time.Since(start).Seconds())
			return out, metadata, err
		}), middleware.After)
	if err != nil {
		return err
	}
	// The Finalize step holds the retry loop, so this runs once per attempt.
	return stack.Finalize.Add(middleware.FinalizeMiddlewareFunc("JobDropThrottleMetrics",
		func(ctx context.Context, in middleware.FinalizeInput, next middleware.FinalizeHandler) (
			middleware.FinalizeOutput, middleware.Metadata, error) {
			out, metadata, err := next.HandleFinalize(ctx, in)
			if err != nil && retry.IsErrorThrottles(retry.DefaultThrottles).IsErrorThrottle(err) == aws.TrueTernary {
				dynamoThrottles.WithLabelValues(awsmiddleware.GetOperationName(ctx)).Inc()
			}
			return out, metadata, err
		}), middleware.After)
}

// outcome: a failed condition ("only if it doesn't exist yet") is how the
// app asks some questions, so it isn't counted as an error.
func outcome(err error) string {
	var failed *types.ConditionalCheckFailedException
	switch {
	case err == nil:
		return "ok"
	case errors.As(err, &failed):
		return "condition_failed"
	default:
		return "error"
	}
}
