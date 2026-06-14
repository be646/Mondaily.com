alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table nodes enable row level security;
alter table edges enable row level security;
alter table activities enable row level security;
alter table agent_jobs enable row level security;
alter table chat_threads enable row level security;
alter table chat_messages enable row level security;
alter table lists enable row level security;
alter table list_entries enable row level security;
alter table object_definitions enable row level security;

create or replace function get_user_workspace_ids()
returns uuid[] language sql security definer as $$
  select array(
    select workspace_id from workspace_members
    where user_id = auth.jwt() ->> 'sub'
  )
$$;

create or replace function user_workspace_role(p_workspace_id uuid)
returns text language sql security definer as $$
  select role from workspace_members
  where workspace_id = p_workspace_id
  and user_id = auth.jwt() ->> 'sub'
  limit 1
$$;

create policy nodes_select on nodes for select
  using (workspace_id = any(get_user_workspace_ids()));

create policy nodes_insert on nodes for insert
  with check (workspace_id = any(get_user_workspace_ids()));

create policy nodes_update on nodes for update
  using (workspace_id = any(get_user_workspace_ids()));

create policy nodes_delete on nodes for delete
  using (workspace_id = any(get_user_workspace_ids()) and user_workspace_role(workspace_id) in ('owner','admin'));

create policy edges_all on edges for all
  using (workspace_id = any(get_user_workspace_ids()));

create policy activities_all on activities for all
  using (workspace_id = any(get_user_workspace_ids()));

create policy agent_jobs_all on agent_jobs for all
  using (workspace_id = any(get_user_workspace_ids()));

create policy chat_threads_all on chat_threads for all
  using (workspace_id = any(get_user_workspace_ids()) and user_id = auth.jwt() ->> 'sub');

create policy chat_messages_all on chat_messages for all
  using (thread_id in (
    select id from chat_threads
    where user_id = auth.jwt() ->> 'sub'
  ));

create policy lists_select on lists for select
  using (
    workspace_id = any(get_user_workspace_ids())
    and (access_level = 'workspace' or owner_id = auth.jwt() ->> 'sub')
  );

create policy lists_all_owner on lists for all
  using (owner_id = auth.jwt() ->> 'sub');

create policy list_entries_all on list_entries for all
  using (list_id in (select id from lists));

