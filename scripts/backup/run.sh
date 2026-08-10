#!/bin/sh
# Nightly sovereign backup.
#
# Runs the exporter in a throwaway node container rather than installing Node on the host — every
# other service on this box is containerised, and a backup job is the last thing that should start
# a package-manager dependency chain on a mail server.
#
# Exits non-zero if the export reports a short read, so cron mails root instead of leaving a
# plausible-looking directory that cannot actually restore anything.
set -eu

DIR=/opt/mondaily-backup
OUT=/opt/mondaily-backups
KEEP_DAYS=14

# Secrets come from a 600 file, never the crontab line (which is world-readable via `ps`).
. "$DIR/.env"

docker run --rm \
  -v "$DIR:/app:ro" \
  -v "$OUT:/out" \
  -e SUPABASE_URL="$SUPABASE_URL" \
  -e SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  node:22-alpine \
  node /app/export.mjs --out /out

# Retention. Pruned only AFTER a successful run — `set -e` means a failed export never reaches
# this line, so a broken backup can never delete the last good one.
find "$OUT" -maxdepth 1 -type d -name '20*' -mtime +$KEEP_DAYS -exec rm -rf {} + 2>/dev/null || true

echo "backup ok: $(ls -1 "$OUT" | wc -l) snapshot(s) retained"
