-- Corrective data fix for the "free Command" bug: workspaces that self-provisioned Command/
-- Sovereign (with a trial) before the entitlement fix. Downgrade them to the free Scout baseline,
-- remember what they intended as pending_plan, strip trials from any non-Operator tier, then
-- re-clamp credits to the (now Scout) allotment. Idempotent.

-- 1) Command/Sovereign chosen without payment → free Scout baseline + pending_plan.
UPDATE workspaces
SET settings = (settings - 'trial_ends_at')
  || jsonb_build_object('account_tier', 'scout', 'plan', 'scout', 'pending_plan', settings->>'account_tier')
WHERE settings->>'account_tier' IN ('command', 'sovereign');

-- 2) Only Operator gets a trial — strip stray trial_ends_at from every other tier.
UPDATE workspaces
SET settings = settings - 'trial_ends_at'
WHERE settings ? 'trial_ends_at'
  AND COALESCE(settings->>'account_tier', 'scout') <> 'operator';

-- 3) Re-clamp GRANTS to the (corrected) tier allotment. Purchases/usage untouched. Idempotent.
INSERT INTO ai_credits_ledger (workspace_id, amount, transaction_type, description)
SELECT w.id, -(g.granted - tgt.target), 'grant', 'Reconcile after free-Command fix'
FROM workspaces w
JOIN LATERAL (
  SELECT COALESCE(SUM(amount), 0) AS granted
  FROM ai_credits_ledger l WHERE l.workspace_id = w.id AND l.transaction_type = 'grant'
) g ON TRUE
JOIN LATERAL (
  SELECT CASE COALESCE(w.settings->>'account_tier', w.settings->>'track')
    WHEN 'command' THEN 2000000 WHEN 'sovereign' THEN 2000000
    WHEN 'operator' THEN 500000 WHEN 'business' THEN 500000
    ELSE 50000 END AS target
) tgt ON TRUE
WHERE g.granted > tgt.target;
