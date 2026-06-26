-- Reconcile prod drift: the workspaces.plan CHECK constraint.
--
-- 0001_ubc_schema.sql defined check (plan in ('free','plus','pro','enterprise'))
-- and 0010_autonomous_agents.sql re-declared ('free','pro','enterprise') — NEITHER
-- allows 'trial'. Production was hand-patched (drop + re-add) to support the trial
-- plan label; this migration captures that so a fresh database reproduces prod and
-- the trial pipeline (insertTrialWorkspace → plan='trial') doesn't get rejected.
alter table workspaces drop constraint if exists workspaces_plan_check;
alter table workspaces add constraint workspaces_plan_check
  check (plan in ('free','trial','plus','pro','enterprise'));
