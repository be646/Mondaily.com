-- Reconcile INCLUDED monthly credits so what the UI advertises is actually usable.
--
-- The bug behind the billing screenshot: a wallet's grant rows were seeded at an old/wrong value
-- (e.g. the legacy 50k Scout seed) while the account was entitled to Operator (1,000,000). The
-- catalog showed "1,000,000/mo included" but the ledger had only ~50k granted, so `remaining`
-- ignored the included credits and read 0.
--
-- This migration brings each ENROLLED workspace's `grant` rows up to its RESOLVED entitlement, in a
-- single top-up row per workspace. It mirrors lib/entitlements.ts resolveEntitlement():
--   1. billing_status = 'cancelled'                          -> Scout
--   2. paid (billing_status='active' + a stripe subscription) -> account_tier / plan tier
--   3. trial_ends_at set: future -> Operator, past -> Scout   (expired trial is not an entitlement)
--   4. account_tier / plan is a real tier (no trial marker)   -> that tier
--   5. otherwise                                             -> Scout
--
-- Safety:
--   • Idempotent — the shortfall is (entitlement − current grant sum); a re-run computes ≤ 0 and
--     inserts nothing. Runs may be repeated safely.
--   • Never touches `purchase` or `usage` rows, so purchased credits are always preserved and it can
--     never double-grant.
--   • Only enrolled workspaces (those with at least one ledger row) are affected.
--   • Each correction is logged as a clearly-described `grant` row.

with resolved as (
  select
    w.id as workspace_id,
    case
      -- 1. explicit cancellation
      when coalesce(w.settings->>'billing_status', '') = 'cancelled' then 'scout'
      -- 3. trial marker present: only counts while it's still in the future (expired -> scout below,
      --    unless a real paid tier is set). We evaluate the paid case via account_tier next.
      when (w.settings->>'trial_ends_at') is not null
           and (w.settings->>'trial_ends_at')::timestamptz > now() then 'operator'
      when (w.settings->>'trial_ends_at') is not null
           and (w.settings->>'trial_ends_at')::timestamptz <= now()
           and coalesce(w.settings->>'billing_status','') <> 'active' then 'scout'  -- expired trial
      -- 2 & 4. an activated real tier
      when lower(coalesce(w.settings->>'account_tier', w.plan::text, '')) in ('operator','business') then 'operator'
      when lower(coalesce(w.settings->>'account_tier', w.plan::text, '')) in ('command')            then 'command'
      when lower(coalesce(w.settings->>'account_tier', w.plan::text, '')) in ('sovereign','enterprise') then 'sovereign'
      else 'scout'
    end as tier
  from workspaces w
),
entitlement as (
  select
    r.workspace_id,
    r.tier,
    case r.tier
      when 'operator'  then 1000000
      when 'command'   then 5000000
      when 'sovereign' then 10000000
      else 100000                         -- scout
    end as included_credits
  from resolved r
),
grants as (
  select workspace_id, sum(amount) as granted
  from ai_credits_ledger
  where transaction_type = 'grant'
  group by workspace_id
),
enrolled as (
  select distinct workspace_id from ai_credits_ledger
)
insert into ai_credits_ledger (workspace_id, amount, transaction_type, description)
select
  e.workspace_id,
  ent.included_credits - coalesce(g.granted, 0) as shortfall,
  'grant',
  'reconcile: included-credits top-up to ' || ent.tier || ' entitlement'
from enrolled e
join entitlement ent on ent.workspace_id = e.workspace_id
left join grants g on g.workspace_id = e.workspace_id
where ent.included_credits - coalesce(g.granted, 0) > 0;   -- shortfall only; idempotent
