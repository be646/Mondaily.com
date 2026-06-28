-- AI cost telemetry — per-tenant token ledger.
--
-- The `ai_usage` table predates the tracked migrations (created ad-hoc), so the
-- token/period columns the gateway telemetry (recordAiUsage) writes may be
-- missing in some environments. This migration is fully idempotent: it creates
-- the table if absent and ADDs each column IF NOT EXISTS, so it is safe to run
-- on a database that already has a partial `ai_usage`.
--
-- SECURITY: written server-side only (service-role key). RLS is enabled in
-- 20260626_rls_complete.sql; clients never write usage directly.

CREATE TABLE IF NOT EXISTS ai_usage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       text,
  model         text,
  message_count integer NOT NULL DEFAULT 1,
  prompt_tokens     integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens      integer NOT NULL DEFAULT 0,
  period_start  timestamptz,
  period_end    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Bring an existing/partial table up to the full shape.
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS user_id           text;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS model             text;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS message_count     integer NOT NULL DEFAULT 1;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS prompt_tokens     integer NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS completion_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS total_tokens      integer NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS period_start      timestamptz;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS period_end        timestamptz;
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS created_at        timestamptz NOT NULL DEFAULT now();

-- Hot paths: per-tenant cost queries and monthly billing-window rollups.
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace        ON ai_usage (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_period ON ai_usage (workspace_id, period_start);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
-- (service-role writes only — no client GRANT/POLICY)
