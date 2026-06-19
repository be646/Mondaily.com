-- Tasks table (standalone, not using nodes) and all child tables used by task-details API.

create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null,
  description  text,
  status       text not null default 'todo'
                 check (status in ('todo','in_progress','review','done','blocked')),
  priority     text default 'medium'
                 check (priority in ('urgent','high','medium','low')),
  due_date     timestamptz,
  completed    boolean not null default false,
  labels       text[] default '{}',
  assignee_id  text,
  assignee_email text,
  assignee_name  text,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_workspace_idx on tasks (workspace_id, created_at desc);
create index if not exists tasks_assignee_idx  on tasks (workspace_id, assignee_id);

create table if not exists task_assignees (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  workspace_id uuid not null,
  user_id     text not null,
  email       text,
  name        text,
  permission  text default 'edit',
  created_at  timestamptz not null default now(),
  unique (task_id, user_id)
);
create index if not exists task_assignees_task_idx on task_assignees (task_id);

create table if not exists task_checklist (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references tasks(id) on delete cascade,
  workspace_id    uuid not null,
  text            text not null,
  completed       boolean not null default false,
  added_by_user_id text,
  added_by_name   text,
  created_at      timestamptz not null default now()
);
create index if not exists task_checklist_task_idx on task_checklist (task_id, created_at);

create table if not exists task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  workspace_id uuid not null,
  user_id     text not null,
  user_name   text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists task_comments_task_idx on task_comments (task_id, created_at);

create table if not exists task_comment_reactions (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references task_comments(id) on delete cascade,
  user_id    text not null,
  emoji      text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);

create table if not exists task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  workspace_id uuid not null,
  name        text not null,
  url         text not null,
  size        bigint,
  mime_type   text,
  uploaded_by text,
  created_at  timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on task_attachments (task_id);

create table if not exists task_activity (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  workspace_id uuid,
  user_id     text,
  user_name   text,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists task_activity_task_idx on task_activity (task_id, created_at desc);

create table if not exists task_views (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    text not null,
  viewed_at  timestamptz not null default now(),
  unique (task_id, user_id)
);
