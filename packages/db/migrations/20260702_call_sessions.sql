-- Live calls (member-to-member audio/video) — session records for the LiveKit-backed caller.
-- Additive. Token minting is env-gated (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET);
-- until those are set the /live-calls API reports { enabled:false } and the UI hides calling,
-- mirroring the sovereign fail-closed pattern used by the AI gateway.

CREATE TABLE IF NOT EXISTS call_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  room          text NOT NULL,              -- LiveKit room name (unique per call)
  initiator_id  text NOT NULL,
  invitee_id    text NOT NULL,
  kind          text NOT NULL DEFAULT 'audio',   -- 'audio' | 'video'
  status        text NOT NULL DEFAULT 'ringing', -- ringing | active | ended | missed | declined
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_sessions_ws_invitee   ON call_sessions (workspace_id, invitee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_ws_initiator ON call_sessions (workspace_id, initiator_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_sessions_room  ON call_sessions (room);

-- Realtime so the callee is notified of a ringing call instantly. RLS restricts delivery to the
-- two participants only (the bridge JWT carries sub = user_id + workspace_id). Service-role API
-- writes bypass RLS, so the /live-calls routes are unaffected.
ALTER PUBLICATION supabase_realtime ADD TABLE call_sessions;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_sessions_realtime_participant ON call_sessions;
CREATE POLICY call_sessions_realtime_participant ON call_sessions
  FOR SELECT TO authenticated
  USING (
    workspace_id::text = (auth.jwt() ->> 'workspace_id')
    AND (auth.jwt() ->> 'sub') IN (initiator_id, invitee_id)
  );
