-- Phase 1 — AI run observability. Adds NULLABLE columns to ai_usage only; existing rows stay
-- valid (all new fields default NULL) and the writer degrades gracefully if these don't exist yet.
-- No data migration, no backfill, idempotent.

ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS task_class     text;     -- fast|reasoning|extraction|summarization|support|meeting|discovery
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS provider       text;     -- non-secret backend label (e.g. "openai-compat"); never the URL/key
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS latency_ms     integer;  -- wall-clock of the inference call
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS source_count   integer;  -- grounding sources the caller used, when provided
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS refusal_reason text;     -- set when the model refused / had insufficient data
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS cache_status   text;     -- "hit"|"miss"|NULL (from prompt_tokens_details.cached_tokens if the backend exposes it)

-- Helps the Control Room read recent runs for this workspace efficiently.
CREATE INDEX IF NOT EXISTS idx_ai_usage_ws_created ON ai_usage (workspace_id, created_at DESC);
