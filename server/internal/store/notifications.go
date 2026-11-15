package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/google/uuid"

	"jobdrop/internal/model"
)

// Notifications: one item per "a new job matches you" email, in the user's
// partition, keyed by the job, so nobody's email about a job is ever queued
// twice. While one waits to be sent it's also in GSI2's QUEUED partition,
// the sender's queue, sorted by when each email is due (see keys.go): a
// failed try waits there for its retry without holding up the others.

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
	// When it's next due, while queued.
	NextAttemptAt time.Time  `dynamodbav:"nextAttemptAt"`
	SentAt        *time.Time `dynamodbav:"sentAt,omitempty"`
}

func (i notificationItem) userID() string {
	return strings.TrimPrefix(i.PK, "USER#")
}

// dueAt is when it's next due. An email queued before retries were
// scheduled has no next attempt saved: it was due when queued.
func (i notificationItem) dueAt() time.Time {
	if i.NextAttemptAt.IsZero() {
		return i.CreatedAt
	}
	return i.NextAttemptAt
}

// queuePosition is a queued email's GSI2 sort key: when it's due, then its id.
func queuePosition(due time.Time, id string) string {
	return sortTime(due) + "#" + id
}

// QueueNotification records that the user should be emailed about the job,
// and reports false if they already have an email about it (queued or not).
func QueueNotification(ctx context.Context, d *DB, userID, jobID string) (bool, error) {
	k := notificationKey(userID, jobID)
	now := model.Now()
	id := uuid.NewString()
	item := notificationItem{PK: k.PK, SK: k.SK, GSI2PK: "QUEUED", GSI2SK: queuePosition(now, id), ID: id,
		JobID: jobID, Status: model.Queued, CreatedAt: now, NextAttemptAt: now}
	err := d.put(ctx, item, "attribute_not_exists(PK)")
	if conditionFailed(err) {
		return false, nil
	}
	return err == nil, err
}

// DueNotifications returns the queued emails that are due by now, the
// longest-waiting first, at most limit. GSI2 finds them, in the order they
// fell due; they're then read again from the table, whose answer is up to
// date, so one sent or put off for a retry a moment ago isn't tried again.
func DueNotifications(ctx context.Context, d *DB, now time.Time, limit int) ([]model.Notification, error) {
	page, err := d.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &d.table,
		IndexName:              aws.String(gsi2),
		KeyConditionExpression: aws.String("GSI2PK = :queue AND GSI2SK <= :due"),
		// "~" sorts after every character of an id, so this takes in all
		// that fell due at or before now.
		ExpressionAttributeValues: values(map[string]any{":queue": "QUEUED", ":due": sortTime(now) + "#~"}),
		Limit:                     aws.Int32(int32(limit)),
	}) // only the first page: the longest waiting
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
	items = slices.DeleteFunc(items, func(i notificationItem) bool {
		return i.Status != model.Queued || i.dueAt().After(now)
	})
	slices.SortFunc(items, func(a, b notificationItem) int { return a.dueAt().Compare(b.dueAt()) })
	return withDetails(ctx, d, items)
}

// SaveNotification records the outcome of a send attempt. One still queued
// (a failed try, to retry) moves to its new place in the queue; one that's
// no longer queued leaves the queue by losing its GSI2 keys.
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
	if n.Status == model.Queued {
		expression += ", #nextAttemptAt = :next, GSI2SK = :position"
		vals[":next"] = n.NextAttemptAt
		vals[":position"] = queuePosition(n.NextAttemptAt, n.ID)
	} else {
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

// QueueStatus is how many emails are queued, and when the first of them is
// due (the zero time when there are none). It reads GSI2, so it may be a
// moment behind; it's for the queue-depth metric and for when the sender
// should look again.
func QueueStatus(ctx context.Context, d *DB) (int, time.Time, error) {
	input := inIndex(gsi2, "QUEUED")
	input.ProjectionExpression = aws.String("GSI2SK")
	queue, err := query[struct{ GSI2SK string }](ctx, d, input) // in the order they fall due
	if err != nil || len(queue) == 0 {
		return 0, time.Time{}, err
	}
	first, _, _ := strings.Cut(queue[0].GSI2SK, "#")
	due, err := time.Parse(sortTimeLayout, first)
	return len(queue), due, err
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
			LastError: item.LastError, CreatedAt: item.CreatedAt, NextAttemptAt: item.dueAt(), SentAt: item.SentAt,
			User: user, Job: job}
	}
	return notifications, nil
}
