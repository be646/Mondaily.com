-- Clerk → Supabase Realtime bridge for the Agent Neural Operation Center.
-- Activates true postgres_changes streaming for agent_jobs. Until this runs, the API's
-- /realtime/token returns enabled:false and the client stays on adaptive polling (no breakage).
--
-- Prereqs (set in the API/Vercel env):
--   SUPABASE_JWT_SECRET  — the project's JWT secret (Supabase → Settings → API → JWT Secret)
--   SUPABASE_ANON_KEY    — the project's anon public key
--   SUPABASE_URL         — already set

-- 1) Stream agent_jobs row changes over Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE agent_jobs;

-- 2) RLS so a bridged token only receives ITS OWN workspace's rows. The API writes with the
--    service-role key, which bypasses RLS, so existing agent logging is unaffected.
ALTER TABLE agent_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_jobs_realtime_ws ON agent_jobs;
CREATE POLICY agent_jobs_realtime_ws ON agent_jobs
  FOR SELECT TO authenticated
  USING (workspace_id::text = (auth.jwt() ->> 'workspace_id'));
