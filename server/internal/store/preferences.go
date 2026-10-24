package store

import (
	"context"
	"time"

	"jobdrop/internal/model"
)

// A user's preferences are one item, lists and all, so saving them is a
// single write: there's nothing to keep in step.

type preferencesItem struct {
	PK, SK           string
	ID               string                  `dynamodbav:"id"`
	RoleFamily       *string                 `dynamodbav:"roleFamily,omitempty"`
	RoleLevel        *string                 `dynamodbav:"roleLevel,omitempty"`
	YearsExperience  *int                    `dynamodbav:"yearsExperience,omitempty"`
	ToleranceYears   *int                    `dynamodbav:"toleranceYears,omitempty"`
	Locations        []locationItem          `dynamodbav:"locations"`
	WorkModes        []model.WorkMode        `dynamodbav:"workModes"`
	OpportunityTypes []model.OpportunityType `dynamodbav:"opportunityTypes"`
	EffectiveSince   time.Time               `dynamodbav:"effectiveSince"`
	CreatedAt        time.Time               `dynamodbav:"createdAt"`
	UpdatedAt        time.Time               `dynamodbav:"updatedAt"`
}

func preferencesItemOf(p model.Preferences) preferencesItem {
	k := preferencesKey(p.UserID)
	return preferencesItem{k.PK, k.SK, p.ID, p.RoleFamily, p.RoleLevel, p.YearsExperience, p.ToleranceYears,
		locationItemsOf(p.Locations), orEmpty(p.WorkModes), orEmpty(p.OpportunityTypes), p.EffectiveSince,
		p.CreatedAt, p.UpdatedAt}
}

func (i preferencesItem) preferences(userID string) model.Preferences {
	return model.Preferences{
		ID:     i.ID,
		UserID: userID,
		Settings: model.Settings{
			RoleFamily:       i.RoleFamily,
			RoleLevel:        i.RoleLevel,
			YearsExperience:  i.YearsExperience,
			ToleranceYears:   i.ToleranceYears,
			Locations:        locationsOf(i.Locations),
			WorkModes:        orEmpty(i.WorkModes),
			OpportunityTypes: orEmpty(i.OpportunityTypes),
		},
		EffectiveSince: i.EffectiveSince,
		CreatedAt:      i.CreatedAt,
		UpdatedAt:      i.UpdatedAt,
	}
}

// PreferencesOf returns the user's preferences, or nil if they haven't set any yet.
func PreferencesOf(ctx context.Context, d *DB, userID string) (*model.Preferences, error) {
	var item preferencesItem
	found, err := d.get(ctx, preferencesKey(userID), &item)
	if !found || err != nil {
		return nil, err
	}
	prefs := item.preferences(userID)
	return &prefs, nil
}

func HasPreferences(ctx context.Context, d *DB, userID string) (bool, error) {
	prefs, err := PreferencesOf(ctx, d, userID)
	return prefs != nil, err
}

// SavePreferences writes the user's preferences, replacing what was there.
func SavePreferences(ctx context.Context, d *DB, p *model.Preferences) error {
	return d.put(ctx, preferencesItemOf(*p), "")
}
