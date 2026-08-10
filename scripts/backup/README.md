# Sovereign backup

A full logical export of every tenant table to disk you control. No third-party backup service, no
`pg_dump`, no database password — it runs against PostgREST with the service key, so it works from
a laptop, a CI runner, or a cron box with nothing installed but Node.

```bash
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… pnpm backup                      # → ./backups/<timestamp>/
SUPABASE_URL=… SUPABASE_SERVICE_KEY=… pnpm backup -- --out /vol/backups
```

## What it captures, and what it does not

**Rows.** Schema is not included, because it already lives in `packages/db/migrations` under git.
A restore is: run the migrations, then load the NDJSON. Those two together are complete; either
one alone is not.

## Why it is trustworthy

- **Paged, with a stable sort.** A `select *` returns only the first 1,000 rows — the worst kind of
  backup, because it succeeds and looks right. Paging without an `ORDER BY` is subtler still:
  Postgres may return rows in any order between requests, so page 2 repeats page 1 and skips
  others, giving you the right row *count* and the wrong rows.
- **Counts are verified.** Every table is compared against the count the server reports, and a
  short read exits non-zero so a cron job fails loudly instead of leaving a plausible directory
  that cannot restore anything.
- **NDJSON, one row per line.** Streamable, diffable, and a truncated file loses its last line
  rather than failing to parse at all like a single JSON array would.
- **Absent tables are skipped, not fatal.** Deployments legitimately differ; a backup that aborts
  because one optional feature was never migrated protects nothing.

## Verified

Run against production 2026-08-10: **18,539 rows across 26 tables, every table matching its
server-reported count, 0 corrupt lines**, and the first real customer's workspace, credential and
records all present and parseable.

## Deployed

Running nightly on the Hetzner box (`178.105.166.138`) — which is genuinely off-host, since the
database lives at Supabase.

```
/opt/mondaily-backup/export.mjs   the exporter (this file, copied)
/opt/mondaily-backup/run.sh       the cron wrapper — see run.sh here
/opt/mondaily-backup/.env         SUPABASE_URL + SERVICE_KEY, chmod 600 root-only
/opt/mondaily-backups/<stamp>/    the snapshots, 14-day retention
/var/log/mondaily-backup.log      cron output
```

Crontab: `17 3 * * *`. Off-the-hour on purpose — every cron on earth fires at :00 and Supabase is
shared infrastructure.

**It runs in a throwaway `node:22-alpine` container** rather than installing Node on the host. Every
other service on that box is containerised, and a backup job should be the last thing to start a
package-manager dependency chain on a mail server.

**Retention prunes only after a successful run.** `set -e` means a failed export never reaches the
prune, so a broken backup can never delete the last good one.

Verified on the box under a deliberately cron-like minimal environment (`env -i PATH=/usr/bin:/bin`),
because a job that works interactively and fails under cron is the standard way this silently stops:
exit 0, 18,540 rows, 0 corrupt, real customer workspace recoverable.

## Still to decide

The snapshots sit on one machine. That is off-host from the database, which is the important half,
but it is not off-site — losing that box loses the backups. Copying snapshots to object storage is
the next hardening step and needs a destination you choose.
