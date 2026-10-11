package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// A user's marks on jobs (saved, applied, dismissed) live in job_states:
// one row per user and job.

// MarksOf maps a job id to the user's mark on it.
func MarksOf(ctx context.Context, db DB, userID string) (map[string]model.Mark, error) {
	rows, _ := db.Query(ctx, `select job_id, state from job_states where user_id = $1`, userID)
	marks := map[string]model.Mark{}
	var jobID string
	var mark model.Mark
	_, err := pgx.ForEachRow(rows, []any{&jobID, &mark}, func() error {
		marks[jobID] = mark
		return nil
	})
	return marks, err
}

// MarkOf returns the user's mark on the job, or nil.
func MarkOf(ctx context.Context, db DB, userID, jobID string) (*model.Mark, error) {
	rows, _ := db.Query(ctx, `select state from job_states where user_id = $1 and job_id = $2`, userID, jobID)
	return one(rows, pgx.RowTo[model.Mark])
}

// SetMark replaces whatever mark the job had.
func SetMark(ctx context.Context, db DB, userID, jobID string, mark model.Mark) error {
	_, err := db.Exec(ctx, `
		insert into job_states (id, user_id, job_id, state, updated_at) values ($1, $2, $3, $4, $5)
		on conflict (user_id, job_id) do update set state = excluded.state, updated_at = excluded.updated_at`,
		uuid.NewString(), userID, jobID, mark, model.Now())
	return err
}

func ClearMark(ctx context.Context, db DB, userID, jobID string) error {
	_, err := db.Exec(ctx, `delete from job_states where user_id = $1 and job_id = $2`, userID, jobID)
	return err
}
