package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// Notifications: one row per "a new job matches you" email. Loaded with
// the user, the job and the job's company, which is everything needed to
// send or show one.

const notificationColumns = `n.id, n.status, n.attempts, n.last_error, n.created_at, n.sent_at, ` +
	userColumns + `, ` + jobColumns

const notificationsWithDetails = ` from notifications n join users u on u.id = n.user_id
	join jobs j on j.id = n.job_id join companies c on c.id = j.company_id `

func scanNotification(row pgx.CollectableRow) (model.Notification, error) {
	var n model.Notification
	fields := []any{&n.ID, &n.Status, &n.Attempts, &n.LastError, &n.CreatedAt, &n.SentAt}
	fields = append(fields, userFields(&n.User)...)
	err := row.Scan(append(fields, jobFields(&n.Job)...)...)
	return n, err
}

// QueueNotification records that the user should be emailed about the job.
func QueueNotification(ctx context.Context, db DB, userID, jobID string) error {
	_, err := db.Exec(ctx, `insert into notifications (id, user_id, job_id, status, attempts, created_at)
		values ($1, $2, $3, 'QUEUED', 0, $4)`, uuid.NewString(), userID, jobID, model.Now())
	return err
}

// QueuedNotifications returns the oldest emails waiting to be sent.
func QueuedNotifications(ctx context.Context, db DB, limit int) ([]model.Notification, error) {
	rows, _ := db.Query(ctx, `select `+notificationColumns+notificationsWithDetails+`where n.status = 'QUEUED'
		order by n.created_at limit $1`, limit)
	return pgx.CollectRows(rows, scanNotification)
}

// SaveNotification records the outcome of a send attempt.
func SaveNotification(ctx context.Context, db DB, n model.Notification) error {
	_, err := db.Exec(ctx, `update notifications set status = $2, attempts = $3, last_error = $4, sent_at = $5
		where id = $1`, n.ID, n.Status, n.Attempts, n.LastError, n.SentAt)
	return err
}

// NotificationHistory returns a user's alerts, newest first. Queued ones
// haven't happened yet, so they aren't part of it.
func NotificationHistory(ctx context.Context, db DB, userID string) ([]model.Notification, error) {
	rows, _ := db.Query(ctx, `select `+notificationColumns+notificationsWithDetails+`where n.user_id = $1
		and n.status <> 'QUEUED' order by n.created_at desc, n.id desc`, userID)
	return pgx.CollectRows(rows, scanNotification)
}

// NotificationCountsOf maps a status to how many of the job's notifications have it.
func NotificationCountsOf(ctx context.Context, db DB, jobID string) (map[string]int, error) {
	rows, _ := db.Query(ctx, `select status, count(*) from notifications where job_id = $1 group by status`, jobID)
	counts := map[string]int{}
	var status string
	var n int
	_, err := pgx.ForEachRow(rows, []any{&status, &n}, func() error {
		counts[status] = n
		return nil
	})
	return counts, err
}

func CountQueuedNotifications(ctx context.Context, db DB) (int, error) {
	return count(ctx, db, `select count(*) from notifications where status = 'QUEUED'`)
}
