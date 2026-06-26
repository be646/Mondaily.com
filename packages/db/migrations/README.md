# Database migrations

Migrations are applied **manually via the Supabase SQL editor** (there is no auto-runner in CI/deploy).

## Two historical locations (known drift — consolidate over time)
- `supabase/migrations/` — the original numbered set `0001` … `0018`.
- `packages/db/migrations/` — the current convention (dated `YYYYMMDD_*`), where new migrations go.

When adding a migration, put it here (`packages/db/migrations/`) using the dated format.

## Prod-applied reconciliations (2026-06-26)
These capture changes that were hand-applied to production so a fresh database reproduces prod:
- `20260626_reconcile_plan_constraint.sql` — `workspaces.plan` CHECK now includes `'trial'` (0001/0010 omitted it).
- `20260626_ai_training_logs.sql` — the AI training ledger table (applied to prod).
- `20260626_rls_complete.sql` — RLS backstop for newer tenant tables (apply in SQL editor; safe — the service-role API bypasses RLS).

## Still to verify applied in prod
- `supabase/migrations/0002_rls_policies.sql` — enables RLS + workspace policies on the core tables (nodes, lists, etc.). Confirm it's live; combined with `20260626_rls_complete.sql` this gives full RLS coverage.
