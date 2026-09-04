#!/usr/bin/env bash
# Dumps the JobDrop Postgres database (running in the "db" docker-compose
# service) to a timestamped, gzip-compressed custom-format file. Run from
# the repo root: ./scripts/backup-db.sh [output-dir]
set -euo pipefail

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/jobdrop-$TIMESTAMP.dump"

echo "Backing up database to $OUT_FILE ..."
docker compose exec -T db pg_dump -U jobdrop -d jobdrop --format=custom --compress=9 > "$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "Done. $OUT_FILE ($SIZE)"
