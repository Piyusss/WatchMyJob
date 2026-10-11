package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

const userColumns = `u.id, u.clerk_user_id, u.name, u.email, u.email_verified, u.notifications_paused,
	u.unsubscribe_token, u.created_at`

func userFields(u *model.User) []any {
	return []any{&u.ID, &u.ClerkUserID, &u.Name, &u.Email, &u.EmailVerified, &u.NotificationsPaused,
		&u.UnsubscribeToken, &u.CreatedAt}
}

func scanUser(row pgx.CollectableRow) (model.User, error) {
	var u model.User
	err := row.Scan(userFields(&u)...)
	return u, err
}

func UserByClerkID(ctx context.Context, db DB, clerkUserID string) (*model.User, error) {
	rows, _ := db.Query(ctx, `select `+userColumns+` from users u where u.clerk_user_id = $1`, clerkUserID)
	return one(rows, scanUser)
}

func UserByUnsubscribeToken(ctx context.Context, db DB, token string) (*model.User, error) {
	rows, _ := db.Query(ctx, `select `+userColumns+` from users u where u.unsubscribe_token = $1`, token)
	return one(rows, scanUser)
}

// CreateUser adds a user's row on their first request. The website sends a
// few requests at once right after sign-in; if another one already created
// the row, this insert does nothing and that row is returned instead.
func CreateUser(ctx context.Context, db DB, clerkUserID, name, email string, emailVerified bool) (model.User, error) {
	_, err := db.Exec(ctx, `
		insert into users (id, clerk_user_id, name, email, email_verified, notifications_paused, unsubscribe_token, created_at)
		values ($1, $2, $3, $4, $5, false, $6, $7)
		on conflict (clerk_user_id) do nothing`,
		uuid.NewString(), clerkUserID, name, email, emailVerified, uuid.NewString(), model.Now())
	if err != nil {
		return model.User{}, err
	}
	rows, _ := db.Query(ctx, `select `+userColumns+` from users u where u.clerk_user_id = $1`, clerkUserID)
	return pgx.CollectExactlyOneRow(rows, scanUser)
}

func SetNotificationsPaused(ctx context.Context, db DB, userID string, paused bool) error {
	_, err := db.Exec(ctx, `update users set notifications_paused = $2 where id = $1`, userID, paused)
	return err
}

// DeleteUser removes the user and, through the foreign keys' "on delete
// cascade", everything that belongs to them.
func DeleteUser(ctx context.Context, db DB, userID string) error {
	_, err := db.Exec(ctx, `delete from users where id = $1`, userID)
	return err
}
