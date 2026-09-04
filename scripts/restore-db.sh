#!/usr/bin/env bash
# Restores a JobDrop Postgres backup (produced by backup-db.sh) into the
# "db" docker-compose service. DESTRUCTIVE: drops and recreates the public
# schema before restoring, so every existing row is discarded first.
#
# Usage: ./scripts/restore-db.sh <path-to-dump-file>
set -euo pipefail

DUMP_FILE="${1:?Usage: restore-db.sh <path-to-dump-file>}"
if [ ! -f "$DUMP_FILE" ]; then
  echo "No such file: $DUMP_FILE" >&2
  exit 1
fi

read -p "This will PERMANENTLY DISCARD the current contents of the jobdrop database. Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "Dropping and recreating the public schema ..."
docker compose exec -T db psql -U jobdrop -d jobdrop -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Restoring from $DUMP_FILE ..."
docker compose exec -T db pg_restore -U jobdrop -d jobdrop --no-owner --no-privileges < "$DUMP_FILE"

echo "Done."
