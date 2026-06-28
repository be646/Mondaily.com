-- Weekly training-data export snapshots.
--
-- The training-export Inngest cron (jobs/training-export.ts) compiles the
-- approved ai_training_logs into validated JSONL once a week and stores the
-- artifact + stats here, so the corpus is queryable/downloadable without a
-- manual CLI run. Service-role writes only (RLS enabled, no client policy).
CREATE TABLE IF NOT EXISTS training_exports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  example_count  integer NOT NULL DEFAULT 0,
  approved_rows  integer NOT NULL DEFAULT 0,
  total_tokens   integer NOT NULL DEFAULT 0,
  avg_tokens     integer NOT NULL DEFAULT 0,
  excluded       jsonb   NOT NULL DEFAULT '{}'::jsonb,  -- { injection, empty, oversized }
  jsonl          text,                                  -- the compiled artifact
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_exports_created ON training_exports (created_at desc);

ALTER TABLE training_exports ENABLE ROW LEVEL SECURITY;
-- service role only — the JSONL contains raw approved prompts/outputs
