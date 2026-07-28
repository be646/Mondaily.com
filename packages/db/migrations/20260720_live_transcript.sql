-- Live Multilingual Meeting Intelligence — Phase B: saved live transcript.
-- Final live-caption lines are persisted DURING the call so Meeting Memory has a transcript even if
-- recording/transcription is never opted-in, is still processing, or fails. Additive + fail-closed:
-- nothing else changes, and the recording pipeline is untouched (this is only a fallback/read path).
--
-- Sovereign + workspace-scoped. Idempotent by construction: UNIQUE (workspace_id, room, line_id) means
-- a resent/duplicate caption packet can never create a duplicate transcript line. `room` is the universal
-- session reference (meeting calls: ws_<ws>__meeting__<eventId>; direct calls: the call_sessions.room),
-- server-derived so a client can never target another tenant's room.

CREATE TABLE IF NOT EXISTS call_transcript_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  room            text NOT NULL,                     -- universal session reference (LiveKit room name)
  event_id        text,                              -- calendar event id when this is a meeting call
  call_session_id uuid,                              -- call_sessions.id when a direct-call session row exists
  line_id         text NOT NULL,                     -- CaptionPacket.id (`${participantId}-${seq}`) — idempotency key
  participant_id  text,                              -- speaking participant's identity, when known
  speaker_name    text NOT NULL,                     -- display name of the speaker (never invented)
  text            text NOT NULL,                     -- the finalized caption text (never fabricated)
  lang            text,                              -- detected source language (BCP-47-ish), when known
  ts              bigint NOT NULL,                   -- epoch ms, for ordering
  source          text NOT NULL DEFAULT 'live_caption',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_transcript_lines_uniq UNIQUE (workspace_id, room, line_id)
);

CREATE INDEX IF NOT EXISTS idx_ctl_ws_room_ts  ON call_transcript_lines (workspace_id, room, ts);
CREATE INDEX IF NOT EXISTS idx_ctl_ws_event_ts ON call_transcript_lines (workspace_id, event_id, ts) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ctl_ws_session  ON call_transcript_lines (workspace_id, call_session_id) WHERE call_session_id IS NOT NULL;

-- Service-role API only (all reads/writes go through workspace-scoped Hono routes). Enable RLS with NO
-- policy so the anon/authenticated Supabase clients cannot touch it directly — same posture as our other
-- server-owned tables.
ALTER TABLE call_transcript_lines ENABLE ROW LEVEL SECURITY;
