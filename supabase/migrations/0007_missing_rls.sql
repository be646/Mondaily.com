-- Fix: enable RLS on tables that were missing it

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Teams: visible to all workspace members
CREATE POLICY teams_workspace ON teams FOR ALL
  USING (workspace_id = ANY(get_user_workspace_ids()));

-- Team members: visible to all workspace members, managed by admins/owners
CREATE POLICY team_members_select ON team_members FOR SELECT
  USING (team_id IN (
    SELECT id FROM teams WHERE workspace_id = ANY(get_user_workspace_ids())
  ));

CREATE POLICY team_members_write ON team_members FOR INSERT
  WITH CHECK (team_id IN (
    SELECT id FROM teams WHERE workspace_id = ANY(get_user_workspace_ids())
      AND user_workspace_role(teams.workspace_id) IN ('owner', 'admin')
  ));

CREATE POLICY team_members_delete ON team_members FOR DELETE
  USING (team_id IN (
    SELECT id FROM teams WHERE workspace_id = ANY(get_user_workspace_ids())
      AND user_workspace_role(teams.workspace_id) IN ('owner', 'admin')
  ));

-- API keys: only visible to owner/admin of the workspace
CREATE POLICY api_keys_workspace ON api_keys FOR ALL
  USING (
    workspace_id = ANY(get_user_workspace_ids())
    AND user_workspace_role(workspace_id) IN ('owner', 'admin')
  );

-- Workspace members: members can see who else is in their workspace
-- but only owners/admins can add or remove members
CREATE POLICY workspace_members_select ON workspace_members FOR SELECT
  USING (workspace_id = ANY(get_user_workspace_ids()));

CREATE POLICY workspace_members_write ON workspace_members FOR INSERT
  WITH CHECK (
    workspace_id = ANY(get_user_workspace_ids())
    AND user_workspace_role(workspace_id) IN ('owner', 'admin')
  );

CREATE POLICY workspace_members_delete ON workspace_members FOR DELETE
  USING (
    workspace_id = ANY(get_user_workspace_ids())
    AND user_workspace_role(workspace_id) IN ('owner', 'admin')
  );
