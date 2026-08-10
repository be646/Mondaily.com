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
REPLICA_HOST=root@178.105.172.237   # the search appliance — a second machine we already own

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

# OFF-BOX REPLICA. Snapshots on the machine that made them survive a bad migration but not a dead
# disk, so every run mirrors to the second Hetzner box. Same owner, no new account, no new spend.
#
# The key is dedicated and RESTRICTED: authorized_keys pins it to `rrsync -wo <dir>`, so it can
# write backups into one directory and do nothing else — no shell, no port forward, no read of the
# rest of that host. Verified by trying: a shell attempt is refused, and a write aimed at /root
# lands inside the confined directory instead.
#
# Replication failure does NOT fail the run. The local backup is already complete and verified by
# that point, and losing it to a network blip on the mirror would be the wrong trade — but it is
# reported, so a persistently unreachable replica is visible in the log rather than assumed fine.
if [ -f /root/.ssh/id_backup_replica ]; then
  if rsync -az --delete-after \
      -e "ssh -i /root/.ssh/id_backup_replica -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=20" \
      "$OUT"/ "$REPLICA_HOST":/ 2>&1; then
    echo "replica ok: mirrored to $REPLICA_HOST"
  else
    echo "REPLICA FAILED: could not mirror to $REPLICA_HOST — local backup is still complete" >&2
  fi
else
  echo "replica skipped: no /root/.ssh/id_backup_replica" >&2
fi

echo "backup ok: $(ls -1 "$OUT" | wc -l) snapshot(s) retained"
