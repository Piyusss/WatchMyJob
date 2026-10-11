package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"jobdrop/internal/model"
)

// "Selectable" below means active with its baseline done: see Company.Selectable.

const companyColumns = `c.id, c.slug, c.name, c.domain, c.platform, coalesce(c.board_id, ''), c.active,
	c.initial_sync_done, c.last_synced_at, c.created_at`

func companyFields(c *model.Company) []any {
	return []any{&c.ID, &c.Slug, &c.Name, &c.Domain, &c.Platform, &c.BoardID, &c.Active,
		&c.InitialSyncDone, &c.LastSyncedAt, &c.CreatedAt}
}

func scanCompany(row pgx.CollectableRow) (model.Company, error) {
	var c model.Company
	err := row.Scan(companyFields(&c)...)
	return c, err
}

func CompanyBySlug(ctx context.Context, db DB, slug string) (*model.Company, error) {
	rows, _ := db.Query(ctx, `select `+companyColumns+` from companies c where c.slug = $1`, slug)
	return one(rows, scanCompany)
}

func CompanyByID(ctx context.Context, db DB, id string) (*model.Company, error) {
	rows, _ := db.Query(ctx, `select `+companyColumns+` from companies c where c.id = $1`, id)
	return one(rows, scanCompany)
}

// ActiveCompanies are the ones the sync reads, in name order.
func ActiveCompanies(ctx context.Context, db DB) ([]model.Company, error) {
	rows, _ := db.Query(ctx, `select `+companyColumns+` from companies c where c.active order by c.name`)
	return pgx.CollectRows(rows, scanCompany)
}

// SelectableCompanies are the ones users can watch, in name order.
func SelectableCompanies(ctx context.Context, db DB) ([]model.Company, error) {
	rows, _ := db.Query(ctx, `select `+companyColumns+` from companies c
		where c.active and c.initial_sync_done order by c.name`)
	return pgx.CollectRows(rows, scanCompany)
}

func SelectableCompaniesBySlug(ctx context.Context, db DB, slugs []string) ([]model.Company, error) {
	rows, _ := db.Query(ctx, `select `+companyColumns+` from companies c
		where c.slug = any($1) and c.active and c.initial_sync_done`, slugs)
	return pgx.CollectRows(rows, scanCompany)
}

// TestCompanies are the admin-made ones, newest first.
func TestCompanies(ctx context.Context, db DB) ([]model.Company, error) {
	rows, _ := db.Query(ctx, `select `+companyColumns+` from companies c
		where c.platform = 'TEST' order by c.created_at desc`)
	return pgx.CollectRows(rows, scanCompany)
}

// CreateCompany adds a company, or reports false if its slug is taken.
func CreateCompany(ctx context.Context, db DB, c model.Company) (bool, error) {
	tag, err := db.Exec(ctx, `
		insert into companies (id, slug, name, domain, platform, board_id, active, initial_sync_done, last_synced_at, created_at)
		values ($1, $2, $3, $4, $5, nullif($6, ''), $7, $8, $9, $10)
		on conflict (slug) do nothing`,
		c.ID, c.Slug, c.Name, c.Domain, c.Platform, c.BoardID, c.Active, c.InitialSyncDone, c.LastSyncedAt, c.CreatedAt)
	return tag.RowsAffected() == 1, err
}

func SetCompanyActive(ctx context.Context, db DB, id string, active bool) error {
	_, err := db.Exec(ctx, `update companies set active = $2 where id = $1`, id, active)
	return err
}

// MarkCompanySynced records a finished sync, which is also the end of the
// baseline if this was the company's first.
func MarkCompanySynced(ctx context.Context, db DB, id string, now time.Time) error {
	_, err := db.Exec(ctx, `update companies set initial_sync_done = true, last_synced_at = $2 where id = $1`, id, now)
	return err
}

// CompanyEntry is one line of companies.json.
type CompanyEntry struct {
	Name     string         `json:"name"`
	Slug     string         `json:"slug"`
	Domain   *string        `json:"domain"`
	Platform model.Platform `json:"platform"`
	BoardID  string         `json:"boardId"`
}

// SeedCompanies copies companies.json into the companies table, at every
// startup: new entries are added, changed ones updated, and real companies
// no longer listed are switched off (test companies come from the admin
// pages, never from the file). To follow a new company, add a line to the
// file and restart.
func SeedCompanies(ctx context.Context, db DB, entries []CompanyEntry) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		slugs := make([]string, len(entries))
		for i, e := range entries {
			slugs[i] = e.Slug
			// Moving to another board means starting over with a new baseline,
			// or every job on the new board would look brand new.
			_, err := tx.Exec(ctx, `
				insert into companies (id, slug, name, domain, platform, board_id, active, initial_sync_done, created_at)
				values ($1, $2, $3, $4, $5, $6, true, false, $7)
				on conflict (slug) do update set
					name = excluded.name,
					domain = excluded.domain,
					platform = excluded.platform,
					board_id = excluded.board_id,
					active = true,
					initial_sync_done = companies.initial_sync_done
						and companies.platform = excluded.platform
						and companies.board_id is not distinct from excluded.board_id`,
				uuid.NewString(), e.Slug, e.Name, e.Domain, e.Platform, e.BoardID, model.Now())
			if err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `update companies set active = false
			where platform <> 'TEST' and active and not (slug = any($1))`, slugs)
		return err
	})
}
