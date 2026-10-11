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
	// A PostgreSQL URL. The Java version's JDBC form
	// ("jdbc:postgresql://host:port/db") works too. The user name and
	// password, when set, replace any in the URL.
	DatabaseURL      string
	DatabaseUser     string
	DatabasePassword string
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
	// next ("5m", "20m"). Longer means slower alerts but a database that
	// can sleep in between (Neon's free plan has a monthly compute limit).
	SyncInterval time.Duration
	// The server's own public address, set by Render on its services
	// (RENDER_EXTERNAL_URL). Render's free plan stops a service after 15
	// minutes without requests, which would stop the sync and the emails
	// too; requesting this address every 10 minutes keeps it running.
	KeepAwakeURL string
}

func Load() (Config, error) {
	c := Config{
		Port:             env("PORT", "4000"),
		MetricsPort:      env("METRICS_PORT", "9091"),
		DatabaseURL:      env("DATABASE_URL", "postgresql://jobdrop:jobdrop@localhost:5433/jobdrop"),
		DatabaseUser:     os.Getenv("DATABASE_USERNAME"),
		DatabasePassword: os.Getenv("DATABASE_PASSWORD"),
		// A trailing slash would break the CORS origin check and the email links.
		FrontendURL:       strings.TrimRight(env("FRONTEND_URL", "http://localhost:3000"), "/"),
		ClerkSecretKey:    strings.TrimSpace(os.Getenv("CLERK_SECRET_KEY")),
		BrevoAPIKey:       strings.TrimSpace(os.Getenv("BREVO_API_KEY")),
		BrevoFromEmail:    strings.TrimSpace(os.Getenv("BREVO_FROM_EMAIL")),
		BrevoFromName:     env("BREVO_FROM_NAME", "WatchmyJob.co"),
		SchedulingEnabled: env("SCHEDULING_ENABLED", "true") != "false",
		KeepAwakeURL:      strings.TrimRight(os.Getenv("RENDER_EXTERNAL_URL"), "/"),
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
