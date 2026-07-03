-- Per-feature usage attribution — lets the usage dashboard show WHERE credits go
-- (Discovery vs Chat vs Enrichment…). Purely additive; recordAiUsage falls back to a
-- feature-less write until this runs, so metering never breaks.
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS feature text;
CREATE INDEX IF NOT EXISTS idx_ai_usage_ws_feature ON ai_usage (workspace_id, feature, created_at);
