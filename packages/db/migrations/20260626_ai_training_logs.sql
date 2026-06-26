-- AI Training Ledger
-- Captures human-in-the-loop validation of agent recommendations (Decision
-- Queue approve / reject / edit) so we can later assemble an instruction-tuning
-- corpus from real, human-validated examples.
--
-- SECURITY: written server-side only (service-role key). RLS is ENABLED with NO
-- policy on purpose — only the service role (which bypasses RLS) may read/write.
-- End-user clients must never be able to read this raw-prompt corpus.
CREATE TABLE IF NOT EXISTS ai_training_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_name    text,
  system_prompt text,                       -- tool list / operational guidelines (nullable: not captured at the approval layer)
  user_prompt   text,                       -- raw user prompt / background context block (secret-redacted before insert)
  model_output  jsonb,                      -- the recommendation the model generated
  user_action   text NOT NULL CHECK (user_action IN ('APPROVED','REJECTED','EDITED')),
  edited_output jsonb,                      -- nullable: the human's manual edits, when they edited before approving
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_training_logs_workspace ON ai_training_logs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_training_logs_action    ON ai_training_logs (user_action);

ALTER TABLE ai_training_logs ENABLE ROW LEVEL SECURITY;
-- (intentionally no GRANT/POLICY — service role only)
