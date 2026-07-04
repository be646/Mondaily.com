-- ROOT CAUSE of "1,000,000 credits but tier still Scout":
--   The workspaces.plan column has a CHECK constraint (workspaces_plan_check) that only allowed
--   legacy values ('trial', 'free', 'business', …) and REJECTED 'operator'/'command'/'sovereign'.
--   start-trial / onboarding / activateTier wrote `update({ plan: 'operator', settings: {…} })` in a
--   SINGLE statement, so the constraint violation rolled the WHOLE update back — the settings trial
--   markers (account_tier, trial_ends_at, trial_used) never persisted — while the SEPARATE credit
--   grant still ran. Result: an "Operator trial credits +1,000,000" ledger row on a workspace whose
--   settings still resolve to Scout. Verified live: PATCH plan='operator' → 23514
--   "violates check constraint workspaces_plan_check".
--
-- The application code now writes `settings` (jsonb, the entitlement source of truth) on its own
-- checked statement and the `plan` column best-effort/separately, so this can't recur. This
-- migration (A) relaxes the constraint so the column can hold the canonical tiers, and (B) heals any
-- workspace that was left granted-but-not-activated by completing its trial.

-- ── (A) Relax the plan CHECK constraint ────────────────────────────────────────────────────────
-- Allow the four canonical tiers PLUS every legacy value already in use, so no existing row is
-- invalidated (all current rows are 'trial'). Idempotent: drop-if-exists then add.
alter table workspaces drop constraint if exists workspaces_plan_check;
alter table workspaces add constraint workspaces_plan_check
  check (plan in ('scout','operator','command','sovereign','free','trial','business','personal','pro','enterprise'));

-- ── (B) Heal granted-but-not-activated Operator trials ─────────────────────────────────────────
-- For every workspace that has an "Operator trial credits" grant but no trial marker in settings,
-- complete the activation the failed write never finished: set the entitlement markers so
-- resolveEntitlement() returns Operator. The trial window is anchored to the grant's own timestamp
-- + 14 days, so we honor the original schedule and only heal trials still within their window.
-- Idempotent: the WHERE excludes workspaces that already have trial_ends_at.
with trial_grant as (
  select workspace_id, max(created_at) as granted_at
  from ai_credits_ledger
  where transaction_type = 'grant' and description = 'Operator trial credits'
  group by workspace_id
)
update workspaces w
set
  settings = w.settings || jsonb_build_object(
    'account_tier', 'operator',
    'plan', 'operator',
    'track', 'business',
    'trial_used', true,
    'trial_ends_at', to_char((tg.granted_at + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  plan = 'operator'
from trial_grant tg
where w.id = tg.workspace_id
  and (w.settings->>'trial_ends_at') is null                    -- not already activated (idempotent)
  and coalesce(w.settings->>'billing_status', '') <> 'active'   -- never touch a paid account
  and tg.granted_at + interval '14 days' > now();               -- only trials still within their 14-day window
