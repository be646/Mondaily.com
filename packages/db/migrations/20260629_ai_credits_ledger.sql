-- AI usage credit wallet — an append-only ledger. Balance = SUM(amount):
--   grant / purchase  → positive points
--   usage             → negative points (deducted in real time from Cerebras token usage)
CREATE TABLE IF NOT EXISTS ai_credits_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL,
  amount           numeric NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('grant', 'usage', 'purchase')),
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_credits_ledger_ws_idx ON ai_credits_ledger (workspace_id, created_at DESC);

-- Fast signed balance (avoids fetching every row to sum client-side).
CREATE OR REPLACE FUNCTION ai_credit_balance(ws uuid) RETURNS numeric
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(amount), 0) FROM ai_credits_ledger WHERE workspace_id = ws;
$$;

-- Touched only by the service-role API.
ALTER TABLE ai_credits_ledger ENABLE ROW LEVEL SECURITY;
