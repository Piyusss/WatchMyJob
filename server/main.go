// The JobDrop backend, one program: the REST API the website calls, plus
// two background jobs on timers. The sync re-reads every company's job
// board; the sender emails users about new jobs that match them.
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"jobdrop/internal/api"
	"jobdrop/internal/boards"
	"jobdrop/internal/clerk"
	"jobdrop/internal/config"
	"jobdrop/internal/db"
	"jobdrop/internal/metrics"
	"jobdrop/internal/notify"
	"jobdrop/internal/store"
	"jobdrop/internal/syncer"
)

// companies.json is the list of companies we follow (see store.SeedCompanies).
//
//go:embed companies.json
var companiesJSON []byte

func main() {
	if err := run(); err != nil {
		slog.Error("The server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	// Cancelled on Ctrl+C, or when Docker stops the container.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabaseUser, cfg.DatabasePassword)
	if err != nil {
		return err
	}
	defer pool.Close()
	var companies []store.CompanyEntry
	if err := json.Unmarshal(companiesJSON, &companies); err != nil {
		return fmt.Errorf("companies.json: %w", err)
	}
	if err := store.SeedCompanies(ctx, pool, companies); err != nil {
		return err
	}

	// The clients for calls to other services. The timeouts stop one hung
	// connection from stalling a job: 10 seconds to connect, 30 to start
	// answering, then 90 seconds in all for Clerk and Brevo. A job board
	// gets 5 minutes, because a whole board can be several MB and Lever
	// sometimes sends Palantir's 6 MB at about 50 KB/s.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = 30 * time.Second
	client := &http.Client{Transport: transport, Timeout: 90 * time.Second}
	boardClient := &http.Client{Transport: transport, Timeout: 5 * time.Minute}

	var mailer notify.Mailer = notify.LogMailer{}
	if cfg.BrevoConfigured() {
		mailer = notify.Brevo{Client: client, APIKey: cfg.BrevoAPIKey, FromEmail: cfg.BrevoFromEmail, FromName: cfg.BrevoFromName}
	}
	sender := notify.NewSender(pool, mailer, cfg.FrontendURL)
	jobSync := syncer.New(pool, boards.All(boardClient, pool), sender.Wake)
	metrics.WatchPool(pool)

	// The API, and the metrics Prometheus reads, each on its own port, so
	// the metrics are never served to the public along with the API. The
	// header timeout stops a client that sends a request very slowly from
	// holding a connection open forever.
	servers := []*http.Server{
		{Addr: ":" + cfg.Port, Handler: api.New(pool, clerk.New(cfg.ClerkSecretKey, client), jobSync, cfg),
			ReadHeaderTimeout: 10 * time.Second},
		{Addr: ":" + cfg.MetricsPort, Handler: promhttp.Handler(), ReadHeaderTimeout: 10 * time.Second},
	}
	failed := make(chan error, len(servers))
	for _, server := range servers {
		go func() { failed <- server.ListenAndServe() }()
	}
	slog.Info("Listening", "port", cfg.Port, "metricsPort", cfg.MetricsPort)

	var jobs sync.WaitGroup
	if cfg.SchedulingEnabled {
		// Ten seconds after startup, then SYNC_INTERVAL (five minutes unless
		// set) after each round ends.
		every(ctx, &jobs, "Job sync", 10*time.Second, cfg.SyncInterval, jobSync.SyncAll)
		// Every 15 seconds: send whatever was queued, oldest first.
		every(ctx, &jobs, "Email sending", 15*time.Second, 15*time.Second, sender.SendQueued)
		// On Render: request our own public address every 10 minutes, so the
		// free plan never stops the service (see config.KeepAwakeURL).
		if cfg.KeepAwakeURL != "" {
			every(ctx, &jobs, "Keep-awake request", 10*time.Minute, 10*time.Minute, func(ctx context.Context) error {
				return keepAwake(ctx, client, cfg.KeepAwakeURL+"/health")
			})
		}
	}

	select {
	case err := <-failed: // e.g. the port is already in use
		return err
	case <-ctx.Done():
	}
	slog.Info("Shutting down")
	timeout, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for _, server := range servers {
		_ = server.Shutdown(timeout) // finishes the requests in progress
	}
	jobs.Wait()
	return nil
}

// every runs job in the background: after the first delay, then again
// `delay` after each run ends, until ctx is cancelled. A failed run is
// logged; the next one runs as usual.
func every(ctx context.Context, jobs *sync.WaitGroup, name string, first, delay time.Duration,
	job func(context.Context) error) {
	jobs.Go(func() {
		wait := first
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			runOnce(ctx, name, job)
			wait = delay
		}
	})
}

// keepAwake requests url (our own /health) through the public internet, so
// Render counts it as traffic like any visitor's request.
func keepAwake(ctx context.Context, client *http.Client, url string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, response.Status)
	}
	return nil
}

func runOnce(ctx context.Context, name string, job func(context.Context) error) {
	defer func() {
		if p := recover(); p != nil {
			slog.Error(name+" crashed", "panic", p)
		}
	}()
	if err := job(ctx); err != nil && ctx.Err() == nil {
		slog.Error(name+" failed", "error", err)
	}
}
