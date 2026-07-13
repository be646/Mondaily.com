-- Team goals / targets — the ONLY new state the Team Intelligence "goal attainment" feature needs.
-- Targets are set by an owner/admin against a REAL, already-computed metric (tasks completed,
-- decisions resolved, deals won, records touched, AI credits) for a member or the whole team, over a
-- rolling window. Attainment is computed live against the real oversight metrics — never fabricated.
-- Idempotent; the endpoints fail-closed (treat goals as "not set up") if this table doesn't exist yet.

CREATE TABLE IF NOT EXISTS workspace_goals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   text NOT NULL,
  -- 'member' → target_user_id is set; 'team' → aggregate across everyone (target_user_id NULL).
  scope          text NOT NULL DEFAULT 'member',           -- 'member' | 'team'
  target_user_id text,                                     -- member the goal applies to (NULL for team goals)
  -- Which REAL metric this goal tracks (maps 1:1 to an oversight-matrix field).
  metric         text NOT NULL,                            -- tasks_completed | decisions_resolved | deals_won | records_touched | ai_credits
  target_value   numeric NOT NULL CHECK (target_value > 0),
  window_days    integer NOT NULL DEFAULT 30 CHECK (window_days > 0 AND window_days <= 365),
  label          text,                                     -- optional human label ("Q3 close target")
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  active         boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_workspace_goals_ws ON workspace_goals (workspace_id, active);
CREATE INDEX IF NOT EXISTS idx_workspace_goals_ws_user ON workspace_goals (workspace_id, target_user_id);
