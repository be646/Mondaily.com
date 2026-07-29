-- Add decision_queue to the Supabase realtime publication.
--
-- apps/app/src/routes/dashboard/decisions.tsx subscribes via useTableRealtime("decision_queue")
-- and the cockpit header advertises "live sync", but only call_sessions, internal_messages and
-- agent_jobs were ever published (20260702_call_sessions.sql, 20260702_internal_messages_realtime.sql,
-- 20260629_agent_jobs_realtime.sql). The channel therefore subscribed and silently received
-- nothing — the surface was really 20s polling while claiming to be live.
--
-- Safe to re-run: the DO block skips the table if it is already in the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'decision_queue'
  ) then
    alter publication supabase_realtime add table decision_queue;
  end if;
end $$;

-- Realtime respects RLS. decision_queue is workspace-scoped, so ensure a policy exists that
-- limits streamed rows to workspaces the caller belongs to (same shape as the other realtime
-- tables). No-op if the policy is already present.
alter table decision_queue enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'decision_queue' and policyname = 'decision_queue_workspace_isolation'
  ) then
    create policy decision_queue_workspace_isolation on decision_queue
      for select
      using (workspace_id = any (get_user_workspace_ids()));
  end if;
end $$;
