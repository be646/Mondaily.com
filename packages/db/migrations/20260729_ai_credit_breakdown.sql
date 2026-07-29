-- Server-side credit breakdown.
--
-- WHY: five call sites summed the wallet in JavaScript —
--   lib/credits.ts (reconcileIncludedCredits, burstStatus), routes/credits.ts (balance, diagnostics),
--   routes/usage.ts, routes/support.ts
-- each doing `.select("amount, transaction_type").eq("workspace_id", ws)` with no .limit() and no
-- .order(). Past PostgREST's max-rows cap that returns an ARBITRARY SUBSET, so the totals were
-- nondeterministic: eight identical reads of /credits/balance returned `used` values spanning
-- 134,984 credits with zero AI spend in between. Users saw a balance that never tracked their usage.
--
-- ai_credit_balance() already existed for exactly this reason ("avoids fetching every row to sum
-- client-side") but only returns the net figure; the UI needs the grant/purchase/usage split.
CREATE OR REPLACE FUNCTION ai_credit_breakdown(ws uuid)
  RETURNS TABLE (granted numeric, purchased numeric, used numeric, entries bigint)
  LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'grant'), 0),
    COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'purchase'), 0),
    -- usage rows are stored negative; report the positive magnitude the UI displays
    ABS(COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'usage'), 0)),
    COUNT(*)
  FROM ai_credits_ledger
  WHERE workspace_id = ws;
$$;

-- Usage summed over a trailing window, for the burst cap (same truncation bug, 24h-scoped).
CREATE OR REPLACE FUNCTION ai_credit_usage_since(ws uuid, since timestamptz)
  RETURNS TABLE (used numeric, oldest timestamptz)
  LANGUAGE sql STABLE AS $$
  SELECT ABS(COALESCE(SUM(amount), 0)), MIN(created_at)
  FROM ai_credits_ledger
  WHERE workspace_id = ws AND transaction_type = 'usage' AND created_at >= since;
$$;

-- Supports both aggregates without a full-table scan per workspace.
CREATE INDEX IF NOT EXISTS ai_credits_ledger_ws_type_idx
  ON ai_credits_ledger (workspace_id, transaction_type, created_at DESC);
