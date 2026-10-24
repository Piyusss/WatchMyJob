package store

import (
	"context"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/google/uuid"

	"jobdrop/internal/model"
)

type userItem struct {
	PK, SK string
	// The unsubscribe token, for finding the user by it: see keys.go.
	GSI1PK, GSI1SK      string
	Name                string    `dynamodbav:"name"`
	Email               string    `dynamodbav:"email"`
	EmailVerified       bool      `dynamodbav:"emailVerified"`
	NotificationsPaused bool      `dynamodbav:"notificationsPaused"`
	UnsubscribeToken    string    `dynamodbav:"unsubscribeToken"`
	CreatedAt           time.Time `dynamodbav:"createdAt"`
}

func userItemOf(u model.User) userItem {
	k := profileKey(u.ID)
	return userItem{k.PK, k.SK, "UNSUB#" + u.UnsubscribeToken, "USER#" + u.ID, u.Name, u.Email, u.EmailVerified,
		u.NotificationsPaused, u.UnsubscribeToken, u.CreatedAt}
}

func (i userItem) user() model.User {
	return model.User{ID: strings.TrimPrefix(i.PK, "USER#"), Name: i.Name, Email: i.Email,
		EmailVerified: i.EmailVerified, NotificationsPaused: i.NotificationsPaused,
		UnsubscribeToken: i.UnsubscribeToken, CreatedAt: i.CreatedAt}
}

// UserByID finds a user by their Clerk user id, or returns nil.
func UserByID(ctx context.Context, d *DB, id string) (*model.User, error) {
	var item userItem
	found, err := d.get(ctx, profileKey(id), &item)
	if !found || err != nil {
		return nil, err
	}
	user := item.user()
	return &user, nil
}

func UserByUnsubscribeToken(ctx context.Context, d *DB, token string) (*model.User, error) {
	found, err := query[key](ctx, d, inIndex(gsi1, "UNSUB#"+token))
	if len(found) == 0 || err != nil {
		return nil, err
	}
	return UserByID(ctx, d, strings.TrimPrefix(found[0].PK, "USER#"))
}

// CreateUser adds a user's item on their first request. The website sends
// a few requests at once right after sign-in, so the item is only written
// if there isn't one yet; if another request just created it, that one is
// returned instead.
func CreateUser(ctx context.Context, d *DB, id, name, email string, emailVerified bool) (model.User, error) {
	user := model.User{ID: id, Name: name, Email: email, EmailVerified: emailVerified,
		UnsubscribeToken: uuid.NewString(), CreatedAt: model.Now()}
	err := d.put(ctx, userItemOf(user), "attribute_not_exists(PK)")
	if !conditionFailed(err) {
		return user, err
	}
	existing, err := UserByID(ctx, d, id)
	if err != nil {
		return model.User{}, err
	}
	return *existing, nil
}

func SetNotificationsPaused(ctx context.Context, d *DB, userID string, paused bool) error {
	return d.update(ctx, profileKey(userID), "SET #notificationsPaused = :paused", map[string]any{":paused": paused})
}

// DeleteUser removes the user and everything that belongs to them: it's
// all in their partition (see keys.go). The subscriptions go first, so a
// delete that fails halfway can't leave them still being emailed.
func DeleteUser(ctx context.Context, d *DB, userID string) error {
	input := inPartition(userPartition(userID), "")
	input.ProjectionExpression = aws.String("PK, SK")
	keys, err := query[key](ctx, d, input)
	if err != nil {
		return err
	}
	var subscriptions, rest []key
	for _, k := range keys {
		if strings.HasPrefix(k.SK, "SUB#") {
			subscriptions = append(subscriptions, k)
		} else {
			rest = append(rest, k)
		}
	}
	if err := d.batchDelete(ctx, subscriptions); err != nil {
		return err
	}
	return d.batchDelete(ctx, rest)
}
