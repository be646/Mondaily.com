-- Zoho-style per-module access matrix. Each member/invite carries a jsonb map of
-- module_key -> "none" | "view" | "edit". Empty {} means "fall back to role defaults"
-- (and, for the finance module, the legacy finance_role). Purely additive — existing
-- rows default to {} and keep behaving exactly as before.

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS module_access jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS module_access jsonb NOT NULL DEFAULT '{}'::jsonb;
