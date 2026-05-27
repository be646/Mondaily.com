create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_login timestamptz
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  application_data jsonb not null default '{}'::jsonb,
  saved_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  email text not null,
  created_by uuid references public.users(id) on delete set null,
  expires_at timestamptz not null,
  used boolean not null default false
);

create index if not exists users_email_idx on public.users (lower(email));
create index if not exists workspaces_user_id_idx on public.workspaces (user_id);
create index if not exists invites_email_idx on public.invites (lower(email));
create index if not exists invites_code_idx on public.invites (code);
create index if not exists invites_active_idx on public.invites (used, expires_at);
