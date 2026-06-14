-- ── #3 Priority 1: enrichment tracking on nodes ──────────────────────────────
alter table nodes
  add column if not exists enriched_at         timestamptz,
  add column if not exists enrichment_status   text check (enrichment_status in ('pending','running','done','failed','skipped')),
  add column if not exists relationship_health integer check (relationship_health between 0 and 100),
  add column if not exists health_updated_at   timestamptz,
  add column if not exists health_signals      jsonb default '{}',
  add column if not exists last_chased_at      timestamptz,
  add column if not exists chase_count         integer default 0;

-- ── #3 Priority 2: workspace agent config ─────────────────────────────────────
create table if not exists workspace_agent_config (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  agent_name   text not null,
  enabled      boolean default true,
  config       jsonb default '{}',
  created_at   timestamptz default now(),
  unique (workspace_id, agent_name)
);

alter table workspace_agent_config enable row level security;

create policy workspace_agent_config_all on workspace_agent_config for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()::text
  ));

-- ── #6: email connections (Nylas per user per workspace) ─────────────────────
create table if not exists email_connections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id      text not null,
  provider     text not null,
  grant_id     text not null,
  email        text not null,
  synced_at    timestamptz,
  sync_cursor  text,
  created_at   timestamptz default now(),
  unique (workspace_id, user_id)
);

alter table email_connections enable row level security;

create policy email_connections_member on email_connections for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()::text
  ));

-- ── Stripe customer ID on workspaces (for webhook billing sync) ──────────────
alter table workspaces
  add column if not exists stripe_customer_id text,
  add column if not exists plan text default 'free' check (plan in ('free','pro','enterprise'));

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists idx_nodes_enrichment_status on nodes(workspace_id, enrichment_status)
  where enrichment_status in ('pending','running');

create index if not exists idx_nodes_health on nodes(workspace_id, relationship_health)
  where relationship_health is not null;

create index if not exists idx_nodes_chase on nodes(workspace_id, last_chased_at)
  where last_chased_at is not null;

create index if not exists idx_email_connections_grant on email_connections(grant_id);
