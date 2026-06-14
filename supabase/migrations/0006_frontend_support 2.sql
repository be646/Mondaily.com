CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT,
  type TEXT NOT NULL DEFAULT 'default',
  message TEXT NOT NULL,
  record_name TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_user
  ON notifications(workspace_id, user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    workspace_id = ANY(get_user_workspace_ids())
    AND (user_id IS NULL OR user_id = auth.jwt() ->> 'sub')
  );

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (
    workspace_id = ANY(get_user_workspace_ids())
    AND (user_id IS NULL OR user_id = auth.jwt() ->> 'sub')
  );
