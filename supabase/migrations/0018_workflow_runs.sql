-- 0018_workflow_runs.sql
-- Execution log + dedup ledger for the Workflow Agent execution engine
-- (packages/api/src/jobs/workflow-engine.ts). One row per (workflow, record,
-- trigger occurrence) so a workflow never fires twice for the same event, and
-- so the Status/agent surfaces can show what each workflow actually did.

create table if not exists workflow_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  workflow_id   uuid not null,
  record_id     uuid,
  -- distinguishes repeat triggers for the same record (e.g. a deal that
  -- reaches "Won" — trigger_key encodes the stage so re-entering fires once)
  trigger_key   text not null,
  -- executed | queued | condition_failed | error
  status        text not null,
  actions       jsonb not null default '[]'::jsonb,
  detail        text,
  created_at    timestamptz not null default now()
);

create unique index if not exists workflow_runs_dedup_idx
  on workflow_runs (workflow_id, record_id, trigger_key);
create index if not exists workflow_runs_ws_idx
  on workflow_runs (workspace_id, created_at desc);

alter table workflow_runs enable row level security;
