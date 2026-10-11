package store

import (
	"context"

	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// A user's preferences: one user_preferences row, plus one row per item in
// each of its three lists (preference_work_modes,
// preference_opportunity_types, preference_locations).

const preferencesColumns = `p.id, p.user_id, p.role_family, p.role_level, p.years_experience, p.tolerance_years,
	p.effective_since, p.created_at, p.updated_at`

func scanPreferences(row pgx.CollectableRow) (model.Preferences, error) {
	var p model.Preferences
	err := row.Scan(&p.ID, &p.UserID, &p.RoleFamily, &p.RoleLevel, &p.YearsExperience, &p.ToleranceYears,
		&p.EffectiveSince, &p.CreatedAt, &p.UpdatedAt)
	return p, err
}

const locationColumns = `country_code, country_name, state_code, state_name, city_name`

func scanLocation(row pgx.CollectableRow) (model.Location, error) {
	var l model.Location
	err := row.Scan(&l.CountryCode, &l.CountryName, &l.StateCode, &l.StateName, &l.CityName)
	return l, err
}

// PreferencesOf returns the user's preferences, or nil if they haven't set any yet.
func PreferencesOf(ctx context.Context, db DB, userID string) (*model.Preferences, error) {
	rows, _ := db.Query(ctx, `select `+preferencesColumns+` from user_preferences p where p.user_id = $1`, userID)
	prefs, err := one(rows, scanPreferences)
	if prefs == nil || err != nil {
		return prefs, err
	}

	rows, _ = db.Query(ctx, `select work_mode from preference_work_modes where preferences_id = $1`, prefs.ID)
	if prefs.WorkModes, err = pgx.CollectRows(rows, pgx.RowTo[model.WorkMode]); err != nil {
		return nil, err
	}
	rows, _ = db.Query(ctx, `select opportunity_type from preference_opportunity_types where preferences_id = $1`, prefs.ID)
	if prefs.OpportunityTypes, err = pgx.CollectRows(rows, pgx.RowTo[model.OpportunityType]); err != nil {
		return nil, err
	}
	rows, _ = db.Query(ctx, `select `+locationColumns+` from preference_locations where preferences_id = $1`, prefs.ID)
	if prefs.Locations, err = pgx.CollectRows(rows, scanLocation); err != nil {
		return nil, err
	}
	return prefs, nil
}

func HasPreferences(ctx context.Context, db DB, userID string) (bool, error) {
	return exists(ctx, db, `select exists (select 1 from user_preferences where user_id = $1)`, userID)
}

// SavePreferences writes the row and replaces the three lists, in one
// transaction. It sets p.ID to the stored row's id.
func SavePreferences(ctx context.Context, db DB, p *model.Preferences) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `
			insert into user_preferences (id, user_id, role_family, role_level, years_experience, tolerance_years,
				effective_since, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			on conflict (user_id) do update set role_family = excluded.role_family, role_level = excluded.role_level,
				years_experience = excluded.years_experience, tolerance_years = excluded.tolerance_years,
				effective_since = excluded.effective_since, updated_at = excluded.updated_at
			returning id`,
			p.ID, p.UserID, p.RoleFamily, p.RoleLevel, p.YearsExperience, p.ToleranceYears,
			p.EffectiveSince, p.CreatedAt, p.UpdatedAt)
		id, err := pgx.CollectExactlyOneRow(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		p.ID = id

		for _, table := range []string{"preference_work_modes", "preference_opportunity_types", "preference_locations"} {
			if _, err := tx.Exec(ctx, `delete from `+table+` where preferences_id = $1`, id); err != nil {
				return err
			}
		}
		for _, mode := range p.WorkModes {
			if _, err := tx.Exec(ctx, `insert into preference_work_modes (preferences_id, work_mode) values ($1, $2)`,
				id, mode); err != nil {
				return err
			}
		}
		for _, kind := range p.OpportunityTypes {
			if _, err := tx.Exec(ctx, `insert into preference_opportunity_types (preferences_id, opportunity_type)
				values ($1, $2)`, id, kind); err != nil {
				return err
			}
		}
		for _, l := range p.Locations {
			if _, err := tx.Exec(ctx, `insert into preference_locations (preferences_id, `+locationColumns+`)
				values ($1, $2, $3, $4, $5, $6)`, id, l.CountryCode, l.CountryName, l.StateCode, l.StateName,
				l.CityName); err != nil {
				return err
			}
		}
		return nil
	})
}
