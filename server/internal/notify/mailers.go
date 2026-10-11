package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

// Mailer sends one email.
type Mailer interface {
	Send(ctx context.Context, to string, email Email) error
}

// Brevo sends email through Brevo's API.
type Brevo struct {
	Client    *http.Client
	APIKey    string
	FromEmail string
	FromName  string
}

func (b Brevo) Send(ctx context.Context, to string, email Email) error {
	body, err := json.Marshal(map[string]any{
		"sender":      map[string]string{"email": b.FromEmail, "name": b.FromName},
		"to":          []map[string]string{{"email": to}},
		"subject":     email.Subject,
		"htmlContent": email.HTML,
		"textContent": email.Text,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.brevo.com/v3/smtp/email",
		bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("api-key", b.APIKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := b.Client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	// An error reply counts as a failed attempt.
	if response.StatusCode < 200 || response.StatusCode > 299 {
		reply, _ := io.ReadAll(io.LimitReader(response.Body, 300))
		return fmt.Errorf("Brevo answered %s: %s", response.Status, reply)
	}
	return nil
}

// LogMailer writes each email to the log instead of sending it: what you
// get without Brevo settings, which is what you want locally.
type LogMailer struct{}

func (LogMailer) Send(_ context.Context, to string, email Email) error {
	slog.Info(fmt.Sprintf("Email not sent (Brevo isn't configured)\nTo: %s\nSubject: %s\n%s", to, email.Subject, email.Text))
	return nil
}
