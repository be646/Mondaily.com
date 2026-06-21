-- Decision Queue — the real backing store for "agents recommend, humans
-- approve" across the app (overdue task follow-ups, stale relationships,
-- overdue invoices, credit note disputes, Ask Mondaily recommendations).

create table if not exists decision_queue (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  source_type        text not null,                 -- e.g. 'task','node','invoice','credit_note','ask'
  source_id          uuid,
  agent_name         text not null,                 -- e.g. 'operations','relationship','finance','signal'
  title              text not null,
  summary            text,
  recommended_action text,
  risk_level         text default 'low' check (risk_level in ('low','medium','high')),
  confidence         numeric,                        -- nullable on purpose — never fabricated
  evidence           jsonb default '[]',              -- array of {type,title,node_id,...} SourceMeta-shaped entries
  status             text not null default 'pending' check (status in ('pending','approved','rejected','snoozed','completed')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        text,
  snoozed_until      timestamptz
);

create index if not exists decision_queue_workspace_status_idx on decision_queue (workspace_id, status, created_at desc);
create index if not exists decision_queue_source_idx on decision_queue (workspace_id, source_type, source_id);

alter table decision_queue enable row level security;

create policy decision_queue_member on decision_queue for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()::text
  ));
