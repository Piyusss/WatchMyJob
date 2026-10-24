package store

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"

	"jobdrop/internal/model"
)

// "Selectable" below means active with its baseline done: see Company.Selectable.

type companyItem struct {
	PK, SK           string
	Name             string         `dynamodbav:"name"`
	Domain           *string        `dynamodbav:"domain,omitempty"`
	Platform         model.Platform `dynamodbav:"platform"`
	BoardID          string         `dynamodbav:"boardId,omitempty"`
	Active           bool           `dynamodbav:"active"`
	InitialSyncDone  bool           `dynamodbav:"initialSyncDone"`
	LastSyncedAt     *time.Time     `dynamodbav:"lastSyncedAt,omitempty"`
	CreatedAt        time.Time      `dynamodbav:"createdAt"`
	BoardFingerprint string         `dynamodbav:"boardFingerprint,omitempty"`
	OpenJobs         int            `dynamodbav:"openJobs"`
}

func companyItemOf(c model.Company) companyItem {
	k := companyKey(c.Slug)
	return companyItem{k.PK, k.SK, c.Name, c.Domain, c.Platform, c.BoardID, c.Active, c.InitialSyncDone,
		c.LastSyncedAt, c.CreatedAt, c.BoardFingerprint, c.OpenJobs}
}

func (i companyItem) company() model.Company {
	return model.Company{Slug: i.SK, Name: i.Name, Domain: i.Domain, Platform: i.Platform, BoardID: i.BoardID,
		Active: i.Active, InitialSyncDone: i.InitialSyncDone, LastSyncedAt: i.LastSyncedAt, CreatedAt: i.CreatedAt,
		BoardFingerprint: i.BoardFingerprint, OpenJobs: i.OpenJobs}
}

// A company's role families, in an item of their own (see keys.go).
type roleFamiliesItem struct {
	PK, SK       string
	RoleFamilies []string `dynamodbav:"roleFamilies"`
}

// Companies are all of them, in name order. They're one partition, small
// enough to read whole. The read may be a moment behind (it costs half as
// much): every write that depends on a company reads it with CompanyBySlug.
func Companies(ctx context.Context, d *DB) ([]model.Company, error) {
	input := inPartition(companiesPartition, "")
	input.ConsistentRead = aws.Bool(false)
	items, err := query[companyItem](ctx, d, input)
	if err != nil {
		return nil, err
	}
	companies := make([]model.Company, len(items))
	for i, item := range items {
		companies[i] = item.company()
	}
	slices.SortFunc(companies, func(a, b model.Company) int {
		return cmp.Or(strings.Compare(a.Name, b.Name), strings.Compare(a.Slug, b.Slug))
	})
	return companies, nil
}

func CompanyBySlug(ctx context.Context, d *DB, slug string) (*model.Company, error) {
	var item companyItem
	found, err := d.get(ctx, companyKey(slug), &item)
	if !found || err != nil {
		return nil, err
	}
	company := item.company()
	return &company, nil
}

// companiesBySlug reads the companies with those slugs, for filling in
// the companies of jobs and subscriptions.
func companiesBySlug(ctx context.Context, d *DB, slugs []string) (map[string]model.Company, error) {
	keys := make([]key, len(slugs))
	for i, slug := range slugs {
		keys[i] = companyKey(slug)
	}
	items, err := batchGet[companyItem](ctx, d, keys)
	if err != nil {
		return nil, err
	}
	companies := make(map[string]model.Company, len(items))
	for _, item := range items {
		companies[item.SK] = item.company()
	}
	return companies, nil
}

// ActiveCompanies are the ones the sync reads, in name order.
func ActiveCompanies(ctx context.Context, d *DB) ([]model.Company, error) {
	return filterCompanies(ctx, d, func(c model.Company) bool { return c.Active })
}

// SelectableCompanies are the ones users can watch, in name order.
func SelectableCompanies(ctx context.Context, d *DB) ([]model.Company, error) {
	return filterCompanies(ctx, d, model.Company.Selectable)
}

func SelectableCompaniesBySlug(ctx context.Context, d *DB, slugs []string) ([]model.Company, error) {
	found, err := companiesBySlug(ctx, d, slugs)
	if err != nil {
		return nil, err
	}
	var companies []model.Company
	for _, company := range found {
		if company.Selectable() {
			companies = append(companies, company)
		}
	}
	return companies, nil
}

// TestCompanies are the admin-made ones, newest first.
func TestCompanies(ctx context.Context, d *DB) ([]model.Company, error) {
	companies, err := filterCompanies(ctx, d, func(c model.Company) bool { return c.Platform == model.PlatformTest })
	slices.SortStableFunc(companies, func(a, b model.Company) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return companies, err
}

func filterCompanies(ctx context.Context, d *DB, keep func(model.Company) bool) ([]model.Company, error) {
	all, err := Companies(ctx, d)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(all, func(c model.Company) bool { return !keep(c) }), nil
}

// RoleFamilies are the role names on open jobs right now, in order: the
// choices in the website's role dropdown, and what preferences and test
// jobs may pick. DynamoDB can't collect them from the jobs ("select
// distinct"), so each sync stores its company's (see MarkCompanySynced),
// and this joins them up. A role family is a job title without its level,
// so there are thousands, and the answer is cached (see cache.go); callers
// mustn't change it.
func RoleFamilies(ctx context.Context, d *DB) ([]string, error) {
	families, version, cached := d.roles.get("")
	if cached {
		return families, nil
	}
	input := inPartition(rolesPartition, "")
	input.ConsistentRead = aws.Bool(false)
	items, err := query[roleFamiliesItem](ctx, d, input)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	families = []string{}
	for _, item := range items {
		for _, family := range item.RoleFamilies {
			if !seen[family] {
				seen[family] = true
				families = append(families, family)
			}
		}
	}
	slices.Sort(families)
	d.roles.fill("", families, version)
	return families, nil
}

// IsOpenRoleFamily reports whether an open job has that role family.
func IsOpenRoleFamily(ctx context.Context, d *DB, roleFamily string) (bool, error) {
	families, err := RoleFamilies(ctx, d)
	_, found := slices.BinarySearch(families, roleFamily)
	return found, err
}

// CountOpenJobs adds up the open jobs the syncs counted.
func CountOpenJobs(ctx context.Context, d *DB) (int, error) {
	companies, err := Companies(ctx, d)
	total := 0
	for _, company := range companies {
		total += company.OpenJobs
	}
	return total, err
}

// CreateCompany adds a company, or reports false if its slug is taken.
func CreateCompany(ctx context.Context, d *DB, c model.Company) (bool, error) {
	err := d.put(ctx, companyItemOf(c), "attribute_not_exists(PK)")
	if conditionFailed(err) {
		return false, nil
	}
	return err == nil, err
}

func SetCompanyActive(ctx context.Context, d *DB, slug string, active bool) error {
	return d.update(ctx, companyKey(slug), "SET #active = :active", map[string]any{":active": active})
}

// MarkCompanyChecked records that the sync looked at the company's board
// and found it as last saved.
func MarkCompanyChecked(ctx context.Context, d *DB, slug string, now time.Time) error {
	return d.update(ctx, companyKey(slug), "SET #lastSyncedAt = :now", map[string]any{":now": now})
}

// MarkCompanySynced records a finished sync, which is also the end of the
// baseline if this was the company's first: what the company's jobs, all
// of them as now saved, add up to, and the board's fingerprint. The
// company item is written last, so a fingerprint is only saved once all
// the rest is. It also hands the cache the company's open jobs (see cache.go).
func MarkCompanySynced(ctx context.Context, d *DB, slug string, now time.Time, fingerprint string, jobs []model.Job) error {
	var open []jobItem
	seen := map[string]bool{}
	families := []string{}
	for _, job := range jobs {
		if job.Status != model.Active {
			continue
		}
		open = append(open, jobItemOf(job))
		if job.RoleFamily != nil && !seen[*job.RoleFamily] {
			seen[*job.RoleFamily] = true
			families = append(families, *job.RoleFamily)
		}
	}
	slices.Sort(families)
	defer d.roles.forget("")

	k := roleFamiliesKey(slug)
	err := d.put(ctx, roleFamiliesItem{k.PK, k.SK, families}, "")
	if err == nil {
		err = d.update(ctx, companyKey(slug), `SET #initialSyncDone = :true, #lastSyncedAt = :now,
			#boardFingerprint = :fingerprint, #openJobs = :open`,
			map[string]any{":true": true, ":now": now, ":fingerprint": fingerprint, ":open": len(open)})
	}
	if err != nil {
		d.open.forget(slug)
		return err
	}
	d.open.set(slug, open)
	return nil
}

// CompanyEntry is one line of companies.json.
type CompanyEntry struct {
	Name     string         `json:"name"`
	Slug     string         `json:"slug"`
	Domain   *string        `json:"domain"`
	Platform model.Platform `json:"platform"`
	BoardID  string         `json:"boardId"`
}

// SeedCompanies brings the companies in line with companies.json, at every
// startup: new entries are added, changed ones updated, and real companies
// no longer listed are switched off (test companies come from the admin
// pages, never from the file). To follow a new company, add a line to the
// file and restart.
func SeedCompanies(ctx context.Context, d *DB, entries []CompanyEntry) error {
	slugs := make([]string, len(entries))
	for i, e := range entries {
		slugs[i] = e.Slug
	}
	existing, err := companiesBySlug(ctx, d, slugs)
	if err != nil {
		return err
	}
	for _, e := range entries {
		company, found := existing[e.Slug]
		if !found {
			company = model.Company{Slug: e.Slug, CreatedAt: model.Now()}
		}
		updated := company
		updated.Name, updated.Domain, updated.Platform, updated.BoardID, updated.Active = e.Name, e.Domain, e.Platform, e.BoardID, true
		// Moving to another board means starting over with a new baseline,
		// or every job on the new board would look brand new.
		if company.Platform != e.Platform || company.BoardID != e.BoardID {
			updated.InitialSyncDone = false
			updated.BoardFingerprint = ""
		}
		if found && sameSeed(company, updated) {
			continue // nothing to write
		}
		if err := d.put(ctx, companyItemOf(updated), ""); err != nil {
			return err
		}
	}

	all, err := Companies(ctx, d)
	if err != nil {
		return err
	}
	for _, company := range all {
		if company.Platform != model.PlatformTest && company.Active && !slices.Contains(slugs, company.Slug) {
			if err := SetCompanyActive(ctx, d, company.Slug, false); err != nil {
				return err
			}
		}
	}
	return nil
}

// sameSeed: what companies.json sets, and the baseline that depends on it, are unchanged.
func sameSeed(a, b model.Company) bool {
	return a.Name == b.Name && sameText(a.Domain, b.Domain) && a.Platform == b.Platform && a.BoardID == b.BoardID &&
		a.Active == b.Active && a.InitialSyncDone == b.InitialSyncDone
}

func sameText(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
