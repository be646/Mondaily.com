-- Decision Queue Increment 2: threaded comments + reviewer assignment.
-- Purely additive. Nothing existing reads these until the new endpoints/UI ship, and approve/
-- reject/snooze/bulk/training capture are untouched.

-- Threaded comments on a decision (workspace-scoped, cascade-deleted with the decision).
create table if not exists decision_comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  decision_id  uuid not null references decision_queue(id) on delete cascade,
  author_id    text not null,
  author_name  text,
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists decision_comments_decision_idx on decision_comments (workspace_id, decision_id, created_at);

-- Reviewer assignment on the decision itself.
alter table decision_queue add column if not exists assignee_id    text;
alter table decision_queue add column if not exists assignee_email text;
create index if not exists decision_queue_assignee_idx on decision_queue (workspace_id, assignee_id);

-- RLS — mirror the decision_queue_member policy (members of the workspace only). The service-role
-- API bypasses RLS and already scopes every query by workspace_id; this governs any direct client.
alter table decision_comments enable row level security;
drop policy if exists decision_comments_member on decision_comments;
create policy decision_comments_member on decision_comments
  for all
  using (workspace_id in (select workspace_id from workspace_members where user_id = auth.uid()::text));
