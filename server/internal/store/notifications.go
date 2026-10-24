package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/google/uuid"

	"jobdrop/internal/model"
)

// Notifications: one item per "a new job matches you" email, in the user's
// partition, keyed by the job, so nobody is ever emailed twice about the
// same job. While one waits to be sent it's also in GSI2's QUEUED
// partition, the sender's queue (see keys.go).

type notificationItem struct {
	PK, SK string
	// Set only while it's queued.
	GSI2PK    string                   `dynamodbav:",omitempty"`
	GSI2SK    string                   `dynamodbav:",omitempty"`
	ID        string                   `dynamodbav:"id"`
	JobID     string                   `dynamodbav:"jobId"`
	Status    model.NotificationStatus `dynamodbav:"status"`
	Attempts  int                      `dynamodbav:"attempts"`
	LastError *string                  `dynamodbav:"lastError,omitempty"`
	CreatedAt time.Time                `dynamodbav:"createdAt"`
	SentAt    *time.Time               `dynamodbav:"sentAt,omitempty"`
}

func (i notificationItem) userID() string {
	return strings.TrimPrefix(i.PK, "USER#")
}

// QueueNotification records that the user should be emailed about the job,
// and reports false if they already have an email about it (queued or not).
func QueueNotification(ctx context.Context, d *DB, userID, jobID string) (bool, error) {
	k := notificationKey(userID, jobID)
	now := model.Now()
	id := uuid.NewString()
	item := notificationItem{k.PK, k.SK, "QUEUED", sortTime(now) + "#" + id, id, jobID, model.Queued, 0, nil, now, nil}
	err := d.put(ctx, item, "attribute_not_exists(PK)")
	if conditionFailed(err) {
		return false, nil
	}
	return err == nil, err
}

// QueuedNotifications returns the oldest emails waiting to be sent, at
// most limit. GSI2 finds them; they're then read again from the table,
// whose answer is up to date, so one sent a moment ago isn't sent twice.
func QueuedNotifications(ctx context.Context, d *DB, limit int) ([]model.Notification, error) {
	input := inIndex(gsi2, "QUEUED")
	input.TableName = &d.table
	input.Limit = aws.Int32(int32(limit))
	page, err := d.client.Query(ctx, input) // only the first page: the oldest
	if err != nil {
		return nil, err
	}
	var keys []key
	for _, item := range page.Items {
		keys = append(keys, keyOf(item))
	}
	items, err := batchGet[notificationItem](ctx, d, keys)
	if err != nil {
		return nil, err
	}
	items = slices.DeleteFunc(items, func(i notificationItem) bool { return i.Status != model.Queued })
	slices.SortFunc(items, func(a, b notificationItem) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return withDetails(ctx, d, items)
}

// SaveNotification records the outcome of a send attempt. One that's no
// longer queued leaves the queue by losing its GSI2 keys.
func SaveNotification(ctx context.Context, d *DB, n model.Notification) error {
	expression := "SET #status = :status, #attempts = :attempts"
	vals := map[string]any{":status": n.Status, ":attempts": n.Attempts}
	if n.LastError != nil {
		expression += ", #lastError = :lastError"
		vals[":lastError"] = *n.LastError
	}
	if n.SentAt != nil {
		expression += ", #sentAt = :sentAt"
		vals[":sentAt"] = *n.SentAt
	}
	if n.Status != model.Queued {
		expression += " REMOVE GSI2PK, GSI2SK"
	}
	return d.update(ctx, notificationKey(n.User.ID, n.Job.ID), expression, vals)
}

// NotificationOf returns the user's notification about the job, or nil.
func NotificationOf(ctx context.Context, d *DB, userID, jobID string) (*model.Notification, error) {
	var item notificationItem
	found, err := d.get(ctx, notificationKey(userID, jobID), &item)
	if !found || err != nil {
		return nil, err
	}
	notifications, err := withDetails(ctx, d, []notificationItem{item})
	if err != nil {
		return nil, err
	}
	return &notifications[0], nil
}

// NotificationHistory returns a user's alerts, newest first. Queued ones
// haven't happened yet, so they aren't part of it.
func NotificationHistory(ctx context.Context, d *DB, userID string) ([]model.Notification, error) {
	items, err := query[notificationItem](ctx, d, inPartition(userPartition(userID), "NOTIF#"))
	if err != nil {
		return nil, err
	}
	items = slices.DeleteFunc(items, func(i notificationItem) bool { return i.Status == model.Queued })
	slices.SortFunc(items, func(a, b notificationItem) int {
		return cmp.Or(b.CreatedAt.Compare(a.CreatedAt), strings.Compare(b.ID, a.ID))
	})
	return withDetails(ctx, d, items)
}

// NotificationCountsOf maps a status to how many of the job's notifications
// have it. A job's notifications are one per watcher of its company, so
// they're read by key, for each watcher, from the table: the admin page
// asks right after the sync queued them, too soon for an index to show
// them.
func NotificationCountsOf(ctx context.Context, d *DB, job model.Job) (map[string]int, error) {
	watchers, err := query[key](ctx, d, inIndex(gsi1, "COMPANY#"+job.Company.Slug))
	if err != nil {
		return nil, err
	}
	keys := make([]key, len(watchers))
	for i, w := range watchers {
		keys[i] = notificationKey(strings.TrimPrefix(w.PK, "USER#"), job.ID)
	}
	items, err := batchGet[notificationItem](ctx, d, keys)
	counts := map[string]int{}
	for _, item := range items {
		counts[string(item.Status)]++
	}
	return counts, err
}

// CountQueuedNotifications counts the queue. It reads GSI2, so it may be a
// moment behind; it's for the queue-depth metric and the sender's "look
// again next round?".
func CountQueuedNotifications(ctx context.Context, d *DB) (int, error) {
	return count(ctx, d, inIndex(gsi2, "QUEUED"))
}

// withDetails turns notification items into notifications, each with its
// user and its job (and the job's company): everything needed to send or
// show it. A user or job that's gone is left as just its id, which the
// sender skips.
func withDetails(ctx context.Context, d *DB, items []notificationItem) ([]model.Notification, error) {
	var userKeys []key
	var jobIDs []string
	for _, item := range items {
		userKeys = append(userKeys, profileKey(item.userID()))
		jobIDs = append(jobIDs, item.JobID)
	}
	userItems, err := batchGet[userItem](ctx, d, userKeys)
	if err != nil {
		return nil, err
	}
	users := map[string]model.User{}
	for _, u := range userItems {
		user := u.user()
		users[user.ID] = user
	}
	jobList, err := JobsByID(ctx, d, jobIDs)
	if err != nil {
		return nil, err
	}
	jobs := map[string]model.Job{}
	for _, job := range jobList {
		jobs[job.ID] = job
	}

	notifications := make([]model.Notification, len(items))
	for i, item := range items {
		user, ok := users[item.userID()]
		if !ok {
			user = model.User{ID: item.userID()}
		}
		job, ok := jobs[item.JobID]
		if !ok {
			job = model.Job{ID: item.JobID}
		}
		notifications[i] = model.Notification{ID: item.ID, Status: item.Status, Attempts: item.Attempts,
			LastError: item.LastError, CreatedAt: item.CreatedAt, SentAt: item.SentAt, User: user, Job: job}
	}
	return notifications, nil
}
