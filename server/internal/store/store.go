// Package store holds every SQL query the app runs, one file per group of
// tables. Each function takes a DB, which is either the connection pool or
// an open transaction, so the same query can run inside a transaction or
// on its own.
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// DB is what a *pgxpool.Pool and a pgx.Tx have in common. Begin lets a
// function that needs a transaction of its own start one with
// pgx.BeginFunc; inside a transaction, that becomes a savepoint. SendBatch
// sends many statements in one round trip (see SaveJobs).
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Begin(ctx context.Context) (pgx.Tx, error)
	SendBatch(ctx context.Context, b *pgx.Batch) pgx.BatchResults
}

// one returns the single row a query found, or nil when it found none.
// (Query's error, if any, comes back from here.)
func one[T any](rows pgx.Rows, scan pgx.RowToFunc[T]) (*T, error) {
	item, err := pgx.CollectOneRow(rows, scan)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// exists runs a "select exists (...)" query.
func exists(ctx context.Context, db DB, sql string, args ...any) (bool, error) {
	rows, _ := db.Query(ctx, sql, args...)
	return pgx.CollectExactlyOneRow(rows, pgx.RowTo[bool])
}

// count runs a "select count(*) ..." query.
func count(ctx context.Context, db DB, sql string, args ...any) (int, error) {
	rows, _ := db.Query(ctx, sql, args...)
	return pgx.CollectExactlyOneRow(rows, pgx.RowTo[int])
}
