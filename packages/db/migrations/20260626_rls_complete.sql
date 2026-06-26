-- ============================================================================
-- RLS BACKSTOP — newer tenant tables not covered by 0002_rls_policies.sql
-- ----------------------------------------------------------------------------
-- Defense-in-depth ONLY. The API uses the Supabase SERVICE-ROLE key, which
-- BYPASSES RLS, so these policies do NOT change API behaviour and are SAFE to
-- apply with zero regression. They protect the data if a non-service path is
-- ever introduced (e.g. a public anon key in the frontend) or a key leaks.
--
-- Reuses get_user_workspace_ids() from 0002 (redefined here so this file is
-- self-contained / idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

create or replace function get_user_workspace_ids()
returns uuid[] language sql security definer as $$
  select array(
    select workspace_id from workspace_members
    where user_id = auth.jwt() ->> 'sub'
  )
$$;

-- One uniform workspace-scoped policy per table (SELECT/INSERT/UPDATE/DELETE).
-- These 13 tables were verified in prod to have a direct workspace_id column.
do $$
declare t text;
begin
  foreach t in array array[
    'decision_queue','tasks','notifications','ai_usage','ai_training_logs',
    'deal_alerts','tags','node_tags','teams','api_keys','email_connections',
    'workspace_invites','workflow_runs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_workspace_isolation', t);
    execute format(
      'create policy %I on %I for all using (workspace_id = any(get_user_workspace_ids())) with check (workspace_id = any(get_user_workspace_ids()))',
      t || '_workspace_isolation', t
    );
  end loop;
end $$;

-- NOTE — child tables without a direct workspace_id (team_members, task_reviews,
-- project_log) need JOIN-based policies (via team_id / task_id). Left out here so
-- this migration applies cleanly; add once their FK columns are confirmed, e.g.:
--   create policy team_members_isolation on team_members for all
--     using (team_id in (select id from teams where workspace_id = any(get_user_workspace_ids())));
