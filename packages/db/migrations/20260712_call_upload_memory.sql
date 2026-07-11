-- Phase 1 Meeting Memory: manual audio upload. Additive only; native call rows untouched.
-- (Already applied in production — this file exists for repo history; no rerun required.)
ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'native',  -- 'native' | 'upload'
  ADD COLUMN IF NOT EXISTS origin_filename text,                            -- uploaded file's original name
  ADD COLUMN IF NOT EXISTS duration_sec    integer,                         -- filled post-STT if known
  ADD COLUMN IF NOT EXISTS language        text,                            -- optional STT hint / detected
  ADD COLUMN IF NOT EXISTS consent         jsonb,                           -- upload consent attestation audit trail
  ADD COLUMN IF NOT EXISTS retention_until timestamptz;                     -- optional auto-purge (nullable = keep)

CREATE INDEX IF NOT EXISTS idx_call_sessions_ws_source
  ON call_sessions (workspace_id, source, created_at DESC);
