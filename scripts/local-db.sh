#!/usr/bin/env bash
# Recreate a LOCAL Postgres database with Supabase stand-ins and all migrations.
# Usage: scripts/local-db.sh <database-name>   (never point this at a hosted database)
set -euo pipefail
DB="${1:?database name required}"
ADMIN_URL="${LOCAL_PG_ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
case "$ADMIN_URL" in *127.0.0.1*|*localhost*) ;; *) echo "Refusing: LOCAL_PG_ADMIN_URL must be local" >&2; exit 1;; esac
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
DB_URL="${ADMIN_URL%/*}/$DB"
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/local-stubs.sql
for f in supabase/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "Local database $DB ready: $DB_URL"
