-- Tags
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  created_at timestamptz default now(),
  unique(workspace_id, name)
);

create table if not exists node_tags (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  workspace_id uuid not null,
  created_at timestamptz default now(),
  unique(node_id, tag_id)
);

-- Lead scoring on nodes
alter table nodes add column if not exists lead_score integer default 0;
alter table nodes add column if not exists lead_score_updated_at timestamptz;
alter table nodes add column if not exists lead_score_signals jsonb default '{}';

-- Deal alerts
create table if not exists deal_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  node_id uuid not null references nodes(id) on delete cascade,
  alert_type text not null, -- 'cold_deal', 'overdue', 'no_activity'
  days_inactive integer,
  dismissed_at timestamptz,
  created_at timestamptz default now()
);

-- Campaign tracking on sequence enrollments (stored in node data jsonb)
-- No schema change needed — tracked in sequences node data

-- RLS
alter table tags enable row level security;
alter table node_tags enable row level security;
alter table deal_alerts enable row level security;

create policy "workspace members can manage tags"
  on tags for all using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "workspace members can manage node_tags"
  on node_tags for all using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "workspace members can manage deal_alerts"
  on deal_alerts for all using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- Indexes
create index if not exists idx_node_tags_node_id on node_tags(node_id);
create index if not exists idx_node_tags_tag_id on node_tags(tag_id);
create index if not exists idx_tags_workspace_id on tags(workspace_id);
create index if not exists idx_deal_alerts_workspace_id on deal_alerts(workspace_id);
create index if not exists idx_nodes_lead_score on nodes(lead_score);
