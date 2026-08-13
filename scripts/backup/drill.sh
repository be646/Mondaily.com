#!/usr/bin/env bash
#
# RESTORE DRILL — prove a backup can actually come back, by putting it back.
#
# Run this on the box that holds the replicated backups. It restores the newest set into a throwaway
# Postgres, lets Postgres validate every foreign key at COMMIT, queries the result as a database
# rather than counting files, and then destroys the container.
#
# It reads the backups where they already sit and writes nothing outside the container, so it moves
# no customer data anywhere new — the reason the drill belongs on this box and not on a laptop.
#
# WHY THIS EXISTS: on 2026-08-10 the backup had run nightly for days and had never been restored.
# The first replay failed immediately — `malformed array literal: "[]"` — because the generator was
# type-blind and rendered `text[]` columns as JSON. Nothing short of a real replay would have found
# it. A backup nobody has restored is a hypothesis, so this turns it into a repeatable test.
#
#   ./drill.sh                       # newest backup in the default replica directory
#   ./drill.sh /path/to/backup-set   # a specific one
#
set -euo pipefail

# Where backups live differs BY BOX, and hardcoding one path made this script work only on the
# replica machine. Deployed to the cron box it died on `ls: /opt/mondaily-backups-replica: No such
# file or directory` — a drill that cannot run is worth exactly as much as a backup nobody restored.
#   .166.138 (cron box)  → /opt/mondaily-backups
#   .172.237 (replica)   → /opt/mondaily-backups-replica
# First existing directory wins; override with REPLICA=… or pass a set explicitly.
if [ -z "${REPLICA:-}" ]; then
  for candidate in /opt/mondaily-backups-replica /opt/mondaily-backups; do
    [ -d "$candidate" ] && ls -1d "$candidate"/20*/ >/dev/null 2>&1 && { REPLICA="$candidate"; break; }
  done
fi
REPLICA="${REPLICA:-/opt/mondaily-backups-replica}"
[ -d "$REPLICA" ] || { echo "no backup directory found (looked for /opt/mondaily-backups{,-replica}); set REPLICA=…"; exit 1; }
SET="${1:-$(ls -1d "$REPLICA"/20*/ | tail -1)}"
WORK="$(mktemp -d)"
trap 'docker rm -f pgdrill >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

echo "restoring: $SET"

# The schema travels with the backup (run.sh writes schema.sql beside it). Falling back to a
# checked-out baseline.sql keeps an older backup set drillable.
SCHEMA="$SET/schema.sql"
[ -f "$SCHEMA" ] || SCHEMA="${SCHEMA_FALLBACK:-$REPLICA/baseline.sql}"
[ -f "$SCHEMA" ] || { echo "no schema found — cannot restore rows into nothing"; exit 1; }

cp "$SCHEMA" "$WORK/schema.sql"
cp "$(dirname "$0")/restore.mjs" "$WORK/" 2>/dev/null || cp "$REPLICA/restore.mjs" "$WORK/"

docker run --rm -v "$SET:/in:ro" -v "$WORK:/w" -w /w node:22-alpine \
  node restore.mjs /in --schema schema.sql --out restore.sql

docker rm -f pgdrill >/dev/null 2>&1 || true
docker run -d --name pgdrill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill \
  pgvector/pgvector:pg16 >/dev/null
for _ in $(seq 1 60); do docker exec pgdrill pg_isready -U postgres -q && break; sleep 2; done

docker exec -i pgdrill psql -U postgres -d drill -v ON_ERROR_STOP=1 -q < "$WORK/schema.sql"
echo "schema applied"

# ON_ERROR_STOP plus the transaction in restore.sql means this either commits whole or leaves
# nothing. The row-count assertions live inside that transaction, so a short restore aborts here.
docker exec -i pgdrill psql -U postgres -d drill -v ON_ERROR_STOP=1 < "$WORK/restore.sql" \
  | grep -vE '^INSERT' | tail -4

echo
echo "foreign keys Postgres validated at COMMIT: $(
  docker exec pgdrill psql -U postgres -d drill -tAc \
    "select count(*) from pg_constraint where contype = 'f'")"
# `docker exec` WITHOUT -i does not attach stdin, so the heredoc below never reaches psql: it reads
# an empty script, prints nothing, exits 0, and the drill looks like it passed while proving nothing.
# The same shape as every other vacuous check in this codebase — a test that cannot fail.
docker exec -i pgdrill psql -U postgres -d drill <<'SQL'
select w.name, count(n.id) as records from workspaces w
  join nodes n on n.workspace_id = w.id group by w.name order by count(n.id) desc limit 3;
select count(*) filter (where jsonb_typeof(data) = 'object') as queryable_jsonb,
       count(*) as nodes from nodes;
SQL

echo "drill passed — the backup restores into a working database."
