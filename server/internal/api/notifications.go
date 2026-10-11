package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"jobdrop/internal/model"
	"jobdrop/internal/store"
)

type alertJob struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	Location *string         `json:"location"`
	Status   model.JobStatus `json:"status"`
	Company  companySummary  `json:"company"`
}

// alert is one email in the alert history. notificationType and
// deliveredAt are fields the website expects: every alert is about a new
// job, and delivery receipts aren't tracked.
type alert struct {
	ID               string                   `json:"id"`
	NotificationType string                   `json:"notificationType"`
	Status           model.NotificationStatus `json:"status"`
	CreatedAt        time.Time                `json:"createdAt"`
	SentAt           *time.Time               `json:"sentAt"`
	DeliveredAt      *time.Time               `json:"deliveredAt"`
	Job              alertJob                 `json:"job"`
}

// alertHistory is the alerts page: the signed-in user's emails, newest first.
func (s *Server) alertHistory(w http.ResponseWriter, r *http.Request, user model.User) error {
	limit := 25
	if text := strings.TrimSpace(r.URL.Query().Get("limit")); text != "" {
		n, err := strconv.Atoi(text)
		if err != nil {
			return errBadInput
		}
		limit = n
	}
	all, err := store.NotificationHistory(r.Context(), s.db, user.ID)
	if err != nil {
		return err
	}
	page, nextCursor := after(all, r.URL.Query().Get("cursor"), min(max(limit, 1), 100),
		func(n model.Notification) string { return n.ID })

	alerts := make([]alert, len(page))
	for i, n := range page {
		job := n.Job
		alerts[i] = alert{
			ID:               n.ID,
			NotificationType: "NEW_JOB",
			Status:           n.Status,
			CreatedAt:        n.CreatedAt,
			SentAt:           n.SentAt,
			Job:              alertJob{job.ID, job.Title, job.Location, job.Status, summaryOf(job.Company)},
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"notifications": alerts, "nextCursor": nextCursor, "total": len(all)})
	return nil
}

// unsubscribe (public): the "Unsubscribe" link in every email opens a page
// that calls this. It pauses all alerts, which the user can undo in Settings.
func (s *Server) unsubscribe(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		Token *string `json:"token"`
	}
	if err := readJSON(w, r, &body); err != nil {
		return err
	}
	p := problems{}
	p.notBlank("token", body.Token)
	if err := p.err(); err != nil {
		return err
	}
	user, err := store.UserByUnsubscribeToken(r.Context(), s.db, *body.Token)
	if err != nil {
		return err
	}
	if user == nil {
		return notFound("This unsubscribe link is invalid")
	}
	if err := store.SetNotificationsPaused(r.Context(), s.db, user.ID, true); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, map[string]bool{"notificationsPaused": true})
	return nil
}
