-- Workspace invites (pending email invitations)
CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','viewer','guest')),
  finance_role text NOT NULL DEFAULT 'none' CHECK (finance_role IN ('none','viewer','member','reviewer','approver')),
  invited_by uuid REFERENCES auth.users(id),
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_workspace_email_idx ON workspace_invites(workspace_id, email) WHERE accepted_at IS NULL;

-- Mark workspace as onboarded
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS logo_url text;
