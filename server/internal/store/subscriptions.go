package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/google/uuid"

	"jobdrop/internal/model"
)

// Subscriptions: which users watch which companies. Each is in its user's
// partition, and in GSI1 under its company, for the other way round.

type subscriptionItem struct {
	PK, SK         string
	GSI1PK, GSI1SK string
	ID             string    `dynamodbav:"id"`
	CompanySlug    string    `dynamodbav:"companySlug"`
	CreatedAt      time.Time `dynamodbav:"createdAt"`
}

func (i subscriptionItem) subscription(company model.Company) model.Subscription {
	return model.Subscription{ID: i.ID, UserID: strings.TrimPrefix(i.PK, "USER#"), CreatedAt: i.CreatedAt, Company: company}
}

// SubscriptionsOf returns the companies a user watches, by company name.
func SubscriptionsOf(ctx context.Context, d *DB, userID string) ([]model.Subscription, error) {
	items, err := query[subscriptionItem](ctx, d, inPartition(userPartition(userID), "SUB#"))
	if err != nil {
		return nil, err
	}
	slugs := make([]string, len(items))
	for i, item := range items {
		slugs[i] = item.CompanySlug
	}
	companies, err := companiesBySlug(ctx, d, slugs)
	if err != nil {
		return nil, err
	}
	subs := []model.Subscription{}
	for _, item := range items {
		if company, ok := companies[item.CompanySlug]; ok {
			subs = append(subs, item.subscription(company))
		}
	}
	slices.SortFunc(subs, func(a, b model.Subscription) int {
		return cmp.Or(strings.Compare(a.Company.Name, b.Company.Name), strings.Compare(a.Company.Slug, b.Company.Slug))
	})
	return subs, nil
}

func SubscriptionOf(ctx context.Context, d *DB, userID, companySlug string) (*model.Subscription, error) {
	var item subscriptionItem
	found, err := d.get(ctx, subscriptionKey(userID, companySlug), &item)
	if !found || err != nil {
		return nil, err
	}
	company, err := CompanyBySlug(ctx, d, companySlug)
	if company == nil || err != nil {
		return nil, err
	}
	sub := item.subscription(*company)
	return &sub, nil
}

func IsWatching(ctx context.Context, d *DB, userID, companySlug string) (bool, error) {
	var item subscriptionItem
	return d.get(ctx, subscriptionKey(userID, companySlug), &item)
}

// Watch subscribes the user, or reports false if they already watch the company.
func Watch(ctx context.Context, d *DB, userID, companySlug string) (bool, error) {
	k := subscriptionKey(userID, companySlug)
	item := subscriptionItem{k.PK, k.SK, "COMPANY#" + companySlug, "USER#" + userID, uuid.NewString(), companySlug,
		model.Now()}
	err := d.put(ctx, item, "attribute_not_exists(PK)")
	if conditionFailed(err) {
		return false, nil
	}
	return err == nil, err
}

// Unwatch deletes the subscription, or reports false if there was none.
func Unwatch(ctx context.Context, d *DB, userID, companySlug string) (bool, error) {
	return d.delete(ctx, subscriptionKey(userID, companySlug))
}

// UnwatchAll deletes every subscription to the company and returns how many there were.
func UnwatchAll(ctx context.Context, d *DB, companySlug string) (int, error) {
	keys, err := query[key](ctx, d, inIndex(gsi1, "COMPANY#"+companySlug))
	if err != nil {
		return 0, err
	}
	return len(keys), d.batchDelete(ctx, keys)
}

// A Watcher is a user who watches a company, with their preferences (nil
// if they haven't set any yet).
type Watcher struct {
	User        model.User
	Preferences *model.Preferences
}

// WatchersOf returns the users who watch the company: their ids from GSI1,
// then their profiles and preferences in one batch read.
func WatchersOf(ctx context.Context, d *DB, companySlug string) ([]Watcher, error) {
	found, err := query[key](ctx, d, inIndex(gsi1, "COMPANY#"+companySlug))
	if err != nil {
		return nil, err
	}
	var keys []key
	for _, k := range found {
		userID := strings.TrimPrefix(k.PK, "USER#")
		keys = append(keys, profileKey(userID), preferencesKey(userID))
	}
	items, err := d.batchGetItems(ctx, keys)
	if err != nil {
		return nil, err
	}
	users := map[string]model.User{}
	preferences := map[string]*model.Preferences{}
	for _, item := range items {
		k := keyOf(item)
		userID := strings.TrimPrefix(k.PK, "USER#")
		switch k.SK {
		case "PROFILE":
			var u userItem
			if err := attributevalue.UnmarshalMap(item, &u); err != nil {
				return nil, err
			}
			users[userID] = u.user()
		case "PREFS":
			var p preferencesItem
			if err := attributevalue.UnmarshalMap(item, &p); err != nil {
				return nil, err
			}
			prefs := p.preferences(userID)
			preferences[userID] = &prefs
		}
	}
	watchers := []Watcher{}
	for userID, user := range users {
		watchers = append(watchers, Watcher{user, preferences[userID]})
	}
	return watchers, nil
}
