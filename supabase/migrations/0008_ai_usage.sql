create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id text not null,
  model text not null,
  message_count integer not null default 1,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz default now()
);

alter table ai_usage enable row level security;

create policy "workspace members can read ai_usage"
  on ai_usage for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy "workspace members can insert ai_usage"
  on ai_usage for insert
  with check (workspace_id = any(get_user_workspace_ids()));

create index ai_usage_workspace_user_idx on ai_usage(workspace_id, user_id);
create index ai_usage_period_idx on ai_usage(period_start, period_end);
