-- Realtime for internal messaging. Until this runs, the client stays on polling (no breakage).
-- Prereqs (already set for agent_jobs realtime): SUPABASE_JWT_SECRET, SUPABASE_ANON_KEY, SUPABASE_URL.

-- 1) Stream internal_messages row changes over Realtime.
ALTER PUBLICATION supabase_realtime ADD TABLE internal_messages;

-- 2) RLS so a bridged token only receives rows for a conversation it is PART OF — not every
--    message in the workspace. The API writes with the service-role key (bypasses RLS), so the
--    /messages routes are unaffected; this policy governs only what Realtime delivers to clients.
--    The bridge JWT carries sub = user_id and a workspace_id claim (see routes/realtime.ts).
ALTER TABLE internal_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_messages_realtime_participant ON internal_messages;
CREATE POLICY internal_messages_realtime_participant ON internal_messages
  FOR SELECT TO authenticated
  USING (
    workspace_id::text = (auth.jwt() ->> 'workspace_id')
    AND (auth.jwt() ->> 'sub') IN (sender_id, recipient_id)
  );
