// Package config reads the app's settings from environment variables, all
// documented in .env.example. For local development they live in
// server/.env, which scripts/server.mjs loads.
package config

import (
	"errors"
	"os"
	"slices"
	"strings"
	"time"
)

type Config struct {
	Port        string
	MetricsPort string
	// The DynamoDB table (the server creates it if it's missing) and its
	// AWS region. DynamoEndpoint is set only for DynamoDB Local, in
	// development: the client then talks to it instead of AWS. The AWS keys
	// aren't here: the AWS SDK reads them itself (AWS_ACCESS_KEY_ID,
	// AWS_SECRET_ACCESS_KEY).
	DynamoTable    string
	AWSRegion      string
	DynamoEndpoint string
	// The website's address: the only origin allowed to call the API
	// (CORS), and the base of the unsubscribe link in emails.
	FrontendURL    string
	AdminEmails    []string
	ClerkSecretKey string
	BrevoAPIKey    string
	BrevoFromEmail string
	BrevoFromName  string
	// False runs the API alone, without the sync and email timers.
	SchedulingEnabled bool
	// The pause between the end of one sync round and the start of the
	// next ("5m", "20m"). Longer means slower alerts, but also fewer reads
	// and writes of the table, whose capacity is small (see store/table.go).
	SyncInterval time.Duration
	// The server's own public address, set by Render on its services
	// (RENDER_EXTERNAL_URL). Render's free plan stops a service after 15
	// minutes without requests, which would stop the sync and the emails
	// too; requesting this address every 10 minutes keeps it running.
	KeepAwakeURL string
	// When set, the public API port also serves /metrics to callers that
	// present it as a Bearer token: for a hosted Grafana (Grafana Cloud),
	// which can only read a public URL. Unset, metrics stay on METRICS_PORT.
	MetricsToken string
}

func Load() (Config, error) {
	c := Config{
		Port:           env("PORT", "4000"),
		MetricsPort:    env("METRICS_PORT", "9091"),
		DynamoTable:    env("DYNAMODB_TABLE", "jobdrop"),
		AWSRegion:      strings.TrimSpace(os.Getenv("AWS_REGION")),
		DynamoEndpoint: strings.TrimSpace(os.Getenv("DYNAMODB_ENDPOINT")),
		// A trailing slash would break the CORS origin check and the email links.
		FrontendURL:       strings.TrimRight(env("FRONTEND_URL", "http://localhost:3000"), "/"),
		ClerkSecretKey:    strings.TrimSpace(os.Getenv("CLERK_SECRET_KEY")),
		BrevoAPIKey:       strings.TrimSpace(os.Getenv("BREVO_API_KEY")),
		BrevoFromEmail:    strings.TrimSpace(os.Getenv("BREVO_FROM_EMAIL")),
		BrevoFromName:     env("BREVO_FROM_NAME", "WatchmyJob"),
		SchedulingEnabled: env("SCHEDULING_ENABLED", "true") != "false",
		KeepAwakeURL:      strings.TrimRight(os.Getenv("RENDER_EXTERNAL_URL"), "/"),
		MetricsToken:      strings.TrimSpace(os.Getenv("METRICS_TOKEN")),
	}
	for _, email := range strings.Split(os.Getenv("ADMIN_EMAILS"), ",") {
		if email = strings.TrimSpace(email); email != "" {
			c.AdminEmails = append(c.AdminEmails, email)
		}
	}
	interval, err := time.ParseDuration(env("SYNC_INTERVAL", "5m"))
	if err != nil || interval < time.Minute {
		return c, errors.New("SYNC_INTERVAL must be a duration of at least a minute, like 5m or 20m")
	}
	c.SyncInterval = interval
	if c.AWSRegion == "" {
		// Without it, the table could be made in a region far from the server.
		if c.DynamoEndpoint == "" {
			return c, errors.New("AWS_REGION must be set: the region of the DynamoDB table, e.g. us-west-2")
		}
		c.AWSRegion = "us-east-1" // DynamoDB Local doesn't mind which
	}
	// The backend can't check anyone's sign-in without it.
	if c.ClerkSecretKey == "" {
		return c, errors.New("CLERK_SECRET_KEY must be set")
	}
	return c, nil
}

// IsAdmin reports whether the account may use the admin pages: ADMIN_EMAILS
// is a comma-separated list of their emails.
func (c Config) IsAdmin(email string) bool {
	return slices.ContainsFunc(c.AdminEmails, func(admin string) bool { return strings.EqualFold(admin, email) })
}

// BrevoConfigured: without Brevo settings, emails are written to the log
// instead of sent.
func (c Config) BrevoConfigured() bool {
	return c.BrevoAPIKey != "" && c.BrevoFromEmail != ""
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
