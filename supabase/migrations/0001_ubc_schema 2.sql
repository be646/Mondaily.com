create extension if not exists vector;
create extension if not exists pg_net;
create extension if not exists "uuid-ossp";

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  plan text default 'free' check (plan in ('free','plus','pro','enterprise')),
  settings jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists workspace_members (
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id text not null,
  role text default 'member' check (role in ('owner','admin','member','viewer')),
  joined_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists team_members (
  team_id uuid references teams(id) on delete cascade,
  user_id text not null,
  primary key (team_id, user_id)
);

create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  vertical text not null check (vertical in ('sales','realestate','hr','finance','investments','tasks','shared')),
  object_type text not null,
  data jsonb not null default '{}',
  embedding vector(1536),
  fts_vector tsvector,
  ai_summary text,
  ai_updated_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  from_node_id uuid not null references nodes(id) on delete cascade,
  to_node_id uuid not null references nodes(id) on delete cascade,
  relationship text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id) on delete cascade,
  workspace_id uuid not null,
  actor_type text not null check (actor_type in ('human','ai_agent','integration','system')),
  actor_id text,
  action text not null,
  diff jsonb,
  ai_summary text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists object_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  vertical text not null,
  slug text not null,
  name_singular text not null,
  name_plural text not null,
  icon text default 'circle',
  color text default 'gray',
  is_standard boolean default false,
  attributes jsonb default '[]',
  created_at timestamptz default now(),
  unique(workspace_id, slug)
);

create table if not exists agent_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  agent_name text not null,
  trigger_type text not null check (trigger_type in ('manual','scheduled','webhook','signal','ask')),
  status text default 'pending' check (status in ('pending','running','completed','failed','cancelled')),
  input jsonb not null,
  output jsonb,
  steps jsonb default '[]',
  error text,
  node_ids uuid[],
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists chat_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  user_id text not null,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references chat_threads(id) on delete cascade,
  role text check (role in ('user','assistant','tool')),
  content text,
  tool_calls jsonb,
  tool_results jsonb,
  created_at timestamptz default now()
);

create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  object_type text not null,
  name text not null,
  access_level text default 'workspace' check (access_level in ('private','workspace','team')),
  owner_id text,
  filters jsonb default '[]',
  views jsonb default '[]',
  created_at timestamptz default now()
);

create table if not exists list_entries (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references lists(id) on delete cascade,
  node_id uuid references nodes(id) on delete cascade,
  position int,
  entry_data jsonb default '{}',
  created_at timestamptz default now(),
  unique(list_id, node_id)
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  created_by text,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

