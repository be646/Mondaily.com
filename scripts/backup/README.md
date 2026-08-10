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

## Still to decide

Where these land. An export on the machine that made it is not a backup — it needs somewhere
durable and off-host, and a schedule. That is an infrastructure choice, not a code one.
