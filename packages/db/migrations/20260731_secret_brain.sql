-- Secret Brain (shadow mode) — the workspace intelligence engine's ledger.
-- SHADOW MODE CONTRACT: the brain OBSERVES and RECORDS. It never mutates workspace data,
-- never creates decisions, never sends anything. Every run and every signal is logged with
-- evidence so its judgment can be audited BEFORE it is ever allowed to propose work.

create table if not exists brain_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  mode text not null default 'shadow' check (mode in ('shadow')),  -- advisor/approval come later, deliberately
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','failed')),
  signals_count int not null default 0,
  -- proof-of-work: which detectors ran, over how many rows, in how long — honest cost accounting
  proof jsonb not null default '{}'::jsonb,
  cost_tokens int not null default 0,
  error text
);
create index if not exists brain_runs_ws_idx on brain_runs (workspace_id, started_at desc);

create table if not exists intelligence_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  run_id uuid not null references brain_runs(id) on delete cascade,
  kind text not null,          -- stalled_deal | overdue_pileup | aging_decisions | pipeline_concentration | ...
  severity text not null check (severity in ('info','watch','risk')),
  title text not null,
  detail text not null,
  -- evidence: the exact node/task/decision ids + computed numbers this signal is built from
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists intelligence_signals_ws_idx on intelligence_signals (workspace_id, created_at desc);
create index if not exists intelligence_signals_run_idx on intelligence_signals (run_id);
