-- Meeting Memory — recording + transcription lifecycle on call_sessions.
--
-- OPT-IN & FAIL-CLOSED. A session is only recorded when the initiator explicitly opts in
-- (`record = true`) AND the deployment has recording configured (LiveKit egress storage +
-- LIVEKIT_RECORDING_ENABLED). Transcription only runs when SOVEREIGN_STT_URL is set (a
-- self-hosted speech-to-text appliance — no third-party STT, matching FULL SOVEREIGNTY).
-- Until those are set, `record` stays false, nothing is captured, and every status column
-- below stays NULL — the UI shows recording as simply unavailable, never a fake "processing".
--
-- Additive only: existing live-call rows keep working untouched (all new columns nullable /
-- default false). No data backfill.

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS record            boolean NOT NULL DEFAULT false,   -- initiator opted into recording
  ADD COLUMN IF NOT EXISTS egress_id         text,                             -- LiveKit egress id (once started)
  ADD COLUMN IF NOT EXISTS recording_status  text,                             -- null | recording | processing | ready | failed
  ADD COLUMN IF NOT EXISTS recording_url     text,                             -- final file URL from egress (sovereign storage)
  ADD COLUMN IF NOT EXISTS transcript_status text,                             -- null | pending | processing | ready | failed
  ADD COLUMN IF NOT EXISTS memory_node_id    uuid;                             -- the call_record node this recording materialized into

-- Look up a session by its egress id when the LiveKit webhook reports completion.
CREATE INDEX IF NOT EXISTS idx_call_sessions_egress ON call_sessions (egress_id) WHERE egress_id IS NOT NULL;
