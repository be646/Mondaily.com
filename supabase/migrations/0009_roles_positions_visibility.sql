-- Roles: owner, admin, manager, member, guest
alter table workspace_members
  alter column role set default 'member',
  add column if not exists position text;

-- Update role check constraint
alter table workspace_members drop constraint if exists workspace_members_role_check;
alter table workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'manager', 'member', 'guest'));

-- List visibility: workspace (all), shared (shared_with only), private (owner only)
alter table lists add column if not exists visibility text not null default 'workspace'
  check (visibility in ('workspace', 'shared', 'private'));

-- Owner column on lists (clerk user_id of creator)
alter table lists add column if not exists owner_id text;
