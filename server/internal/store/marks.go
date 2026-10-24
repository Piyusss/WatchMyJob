package store

import (
	"context"
	"time"

	"jobdrop/internal/model"
)

// A user's marks on jobs (saved, applied, dismissed): one item per user
// and job, in the user's partition.

type markItem struct {
	PK, SK    string
	JobID     string     `dynamodbav:"jobId"`
	State     model.Mark `dynamodbav:"state"`
	UpdatedAt time.Time  `dynamodbav:"updatedAt"`
}

// MarksOf maps a job id to the user's mark on it.
func MarksOf(ctx context.Context, d *DB, userID string) (map[string]model.Mark, error) {
	items, err := query[markItem](ctx, d, inPartition(userPartition(userID), "MARK#"))
	marks := map[string]model.Mark{}
	for _, item := range items {
		marks[item.JobID] = item.State
	}
	return marks, err
}

// MarkOf returns the user's mark on the job, or nil.
func MarkOf(ctx context.Context, d *DB, userID, jobID string) (*model.Mark, error) {
	var item markItem
	found, err := d.get(ctx, markKey(userID, jobID), &item)
	if !found || err != nil {
		return nil, err
	}
	return &item.State, nil
}

// SetMark replaces whatever mark the job had.
func SetMark(ctx context.Context, d *DB, userID, jobID string, mark model.Mark) error {
	k := markKey(userID, jobID)
	return d.put(ctx, markItem{k.PK, k.SK, jobID, mark, model.Now()}, "")
}

func ClearMark(ctx context.Context, d *DB, userID, jobID string) error {
	_, err := d.delete(ctx, markKey(userID, jobID))
	return err
}
