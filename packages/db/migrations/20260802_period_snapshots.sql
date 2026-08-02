-- Immutable period snapshots.
--
-- What a snapshot IS: evidence of what the numbers said when a period closed. What it is NOT: the
-- source of truth for those numbers. The live ledger stays authoritative, and a snapshot that
-- disagrees with a recomputation is a signal worth showing, not a figure to serve instead. A
-- reporting surface that reads part-snapshot and part-live is a surface whose totals disagree with
-- themselves the first time anyone backdates an invoice.
--
-- Nothing here deletes or rewrites history. Closing a period writes one row and advances nothing
-- destructive; "resetting to zero" is what a date filter already does to a cumulative ledger.

create table if not exists period_snapshots (
  snapshot_id  uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  period_type  text not null check (period_type in ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
  period_key   text not null,                     -- '2026-M08', '2026-Q3', '2026-W31', '2026-Y2026'

  -- The exact span that was closed, so a snapshot can be re-derived without re-guessing the
  -- calendar rules (or the timezone) that were in force when it was written.
  period_start timestamptz not null,
  period_end   timestamptz not null,              -- EXCLUSIVE, matching the period core
  time_zone    text not null default 'UTC',
  week_start   smallint not null default 0,

  metrics      jsonb not null,
  -- What the metrics were computed FROM: row counts and the source ids' digest. A metric alone
  -- cannot be re-verified; with its inputs named, a later recomputation can say precisely where a
  -- drift came from.
  inputs       jsonb not null default '{}'::jsonb,

  closed_at    timestamptz not null default now(),
  -- 'scheduled' | 'backfill' | 'manual'. A number's trustworthiness depends on how it was taken.
  closed_by    text not null default 'scheduled',

  -- Tamper-evidence. `hash` covers the canonical JSON of the snapshot's own content; `prev_hash`
  -- is the hash of the previous snapshot for the same (workspace, period_type). Editing one row
  -- therefore breaks every row after it, which a hash on its own would not catch.
  hash         text not null,
  prev_hash    text,

  -- One close per period, per workspace. This is what makes the worker idempotent: a cron that
  -- fires twice, or a backfill overlapping a scheduled run, conflicts instead of double-counting.
  unique (workspace_id, period_type, period_key)
);

create index if not exists period_snapshots_lookup_idx
  on period_snapshots (workspace_id, period_type, period_key);
create index if not exists period_snapshots_span_idx
  on period_snapshots (workspace_id, period_start, period_end);

alter table period_snapshots enable row level security;
revoke all on period_snapshots from public, anon, authenticated;
-- No UPDATE and no DELETE, deliberately: immutability enforced by the grant, not by convention.
-- A correction is a new snapshot that supersedes, never an edit that erases what was reported.
grant select, insert on period_snapshots to service_role;

-- Belt and braces: even the service role cannot rewrite history by accident.
create or replace function period_snapshots_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'period_snapshots is append-only: % on snapshot % refused', tg_op, old.snapshot_id;
end;
$$;

drop trigger if exists period_snapshots_no_update on period_snapshots;
create trigger period_snapshots_no_update
  before update or delete on period_snapshots
  for each row execute function period_snapshots_immutable();
