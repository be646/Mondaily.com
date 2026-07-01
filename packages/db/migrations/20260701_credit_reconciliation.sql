-- ONE-TIME data correction for the double-grant bug (50k register grant + 500k onboarding grant
-- = 550k). Clamps each enrolled workspace's total GRANTS down to its tier allotment by inserting a
-- single negative correction row. Purchases and usage are untouched (only transaction_type='grant'
-- is summed), so nobody loses credits they paid for. Idempotent: after running, granted == target,
-- so a re-run inserts nothing.
INSERT INTO ai_credits_ledger (workspace_id, amount, transaction_type, description)
SELECT w.id,
       -(g.granted - tgt.target),
       'grant',
       'One-time tier reconciliation (double-grant fix)'
FROM workspaces w
JOIN LATERAL (
  SELECT COALESCE(SUM(amount), 0) AS granted
  FROM ai_credits_ledger l
  WHERE l.workspace_id = w.id AND l.transaction_type = 'grant'
) g ON TRUE
JOIN LATERAL (
  SELECT CASE COALESCE(w.settings->>'account_tier', w.settings->>'track')
    WHEN 'command'   THEN 2000000
    WHEN 'sovereign' THEN 2000000
    WHEN 'operator'  THEN 500000
    WHEN 'business'  THEN 500000
    ELSE 50000
  END AS target
) tgt ON TRUE
WHERE g.granted > tgt.target;
