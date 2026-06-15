ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS finance_role text NOT NULL DEFAULT 'none'
  CHECK (finance_role IN ('none','viewer','member','reviewer','approver'));
