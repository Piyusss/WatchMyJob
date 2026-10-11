// Package db connects to PostgreSQL and brings its schema up to date.
package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Connect opens the connection pool, then applies the migrations the
// database hasn't had yet. user and password, when set, replace any in url.
func Connect(ctx context.Context, url, user, password string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(strings.TrimPrefix(url, "jdbc:"))
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	if user != "" {
		config.ConnConfig.User = user
	}
	if password != "" {
		config.ConnConfig.Password = password
	}
	// pgx reads timestamps in the machine's time zone. UTC keeps every time
	// the API sends in the same form ("...Z"), wherever the server runs.
	config.AfterConnect = func(_ context.Context, conn *pgx.Conn) error {
		conn.TypeMap().RegisterType(&pgtype.Type{Name: "timestamptz", OID: pgtype.TimestamptzOID,
			Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC}})
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	if err := migrate(ctx, pool); err != nil {
		pool.Close()
		return nil, fmt.Errorf("migrating the database: %w", err)
	}
	return pool, nil
}

// migrate runs the files in migrations/ that this database hasn't had yet,
// in order. goose records the ones that ran in its goose_db_version table;
// a schema change goes in a new file, never an edit to one that ran.
func migrate(ctx context.Context, pool *pgxpool.Pool) error {
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return err
	}
	db := stdlib.OpenDBFromPool(pool) // goose works with database/sql
	defer db.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, db, files)
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}
