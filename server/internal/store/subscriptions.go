package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// Subscriptions: which users watch which companies.

const subscriptionColumns = `s.id, s.user_id, s.created_at, ` + companyColumns

const subscriptionsWithCompany = ` from subscriptions s join companies c on c.id = s.company_id `

func scanSubscription(row pgx.CollectableRow) (model.Subscription, error) {
	var s model.Subscription
	err := row.Scan(append([]any{&s.ID, &s.UserID, &s.CreatedAt}, companyFields(&s.Company)...)...)
	return s, err
}

// SubscriptionsOf returns the companies a user watches, by company name.
func SubscriptionsOf(ctx context.Context, db DB, userID string) ([]model.Subscription, error) {
	rows, _ := db.Query(ctx, `select `+subscriptionColumns+subscriptionsWithCompany+`where s.user_id = $1
		order by c.name`, userID)
	return pgx.CollectRows(rows, scanSubscription)
}

func SubscriptionOf(ctx context.Context, db DB, userID, companyID string) (*model.Subscription, error) {
	rows, _ := db.Query(ctx, `select `+subscriptionColumns+subscriptionsWithCompany+`where s.user_id = $1
		and s.company_id = $2`, userID, companyID)
	return one(rows, scanSubscription)
}

func IsWatching(ctx context.Context, db DB, userID, companyID string) (bool, error) {
	return exists(ctx, db, `select exists (select 1 from subscriptions where user_id = $1 and company_id = $2)`,
		userID, companyID)
}

// Watch subscribes the user, or reports false if they already watch the company.
func Watch(ctx context.Context, db DB, userID, companyID string) (bool, error) {
	tag, err := db.Exec(ctx, `insert into subscriptions (id, user_id, company_id, created_at) values ($1, $2, $3, $4)
		on conflict (user_id, company_id) do nothing`, uuid.NewString(), userID, companyID, model.Now())
	return tag.RowsAffected() == 1, err
}

// Unwatch deletes the subscription, or reports false if there was none.
func Unwatch(ctx context.Context, db DB, userID, companyID string) (bool, error) {
	tag, err := db.Exec(ctx, `delete from subscriptions where user_id = $1 and company_id = $2`, userID, companyID)
	return tag.RowsAffected() == 1, err
}

// UnwatchAll deletes every subscription to the company and returns how many there were.
func UnwatchAll(ctx context.Context, db DB, companyID string) (int, error) {
	tag, err := db.Exec(ctx, `delete from subscriptions where company_id = $1`, companyID)
	return int(tag.RowsAffected()), err
}

// WatchersOf returns the users who watch the company.
func WatchersOf(ctx context.Context, db DB, companyID string) ([]model.User, error) {
	rows, _ := db.Query(ctx, `select `+userColumns+` from subscriptions s join users u on u.id = s.user_id
		where s.company_id = $1`, companyID)
	return pgx.CollectRows(rows, scanUser)
}
