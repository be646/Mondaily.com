-- Monthly included-allowance reset, applied lazily on read (lib/credits.ensurePeriodAllowance).
--
-- WHY NO CRON: the catalog sells "N credits / month" and /credits/balance returns a `reset_at`, but
-- nothing ever reset anything — a Scout who spent their 100k never got more, and an ANNUAL
-- subscriber got one grant per YEAR against a per-month promise. A scheduled job that mutates every
-- wallet monthly can fail silently, double-run, or drift; that is the exact failure mode that minted
-- 48,915,590 in duplicate credits on this table. Doing it on read is self-healing.
--
-- Idempotency is enforced HERE rather than in application code: ensurePeriodAllowance checks for the
-- period's marker row and inserts if absent, which is a check-then-act race between concurrent
-- requests. This partial unique index makes the loser's insert fail instead of double-granting.
CREATE UNIQUE INDEX IF NOT EXISTS ai_credits_ledger_period_reset_uniq
  ON ai_credits_ledger (workspace_id, description)
  WHERE transaction_type = 'grant' AND description LIKE 'period reset %';

-- Per-calendar-month usage, for reporting the allowance actually consumed in a period without
-- pulling every row (see the truncation bug in 20260729_ai_credit_breakdown.sql).
CREATE OR REPLACE FUNCTION ai_credit_usage_by_month(ws uuid)
  RETURNS TABLE (month timestamptz, used numeric)
  LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', created_at), ABS(COALESCE(SUM(amount), 0))
  FROM ai_credits_ledger
  WHERE workspace_id = ws AND transaction_type = 'usage'
  GROUP BY 1
  ORDER BY 1 DESC;
$$;
