-- Performance indexes for multi-tenant hot paths.
--
-- NOTE: most boundary columns are ALREADY indexed by earlier migrations:
--   nodes(workspace_id)            -> idx_nodes_workspace
--   nodes(workspace_id,vertical,object_type) -> idx_nodes_type
--   chat_threads(workspace_id,user_id) -> idx_chat_threads_user
--   activities/decision_queue/tasks/list_entries/edges/ai_training_logs(workspace_id) -> covered
-- This migration adds only the gaps found auditing the live query patterns.
-- All CREATE INDEX IF NOT EXISTS, so it is safe + idempotent.

-- lists: the lists GET filters by workspace_id; ownership checks filter owner_id.
create index if not exists idx_lists_workspace on lists (workspace_id);
create index if not exists idx_lists_owner     on lists (owner_id);

-- email_connections: send/read/status look up by (workspace_id, provider);
-- only grant_id was indexed before.
create index if not exists idx_email_connections_workspace on email_connections (workspace_id, provider);

-- workspace_members: requireAuth filters (workspace_id,user_id) [served by PK], but
-- bootstrap finds "any membership for this user" by user_id alone — the PK's leading
-- column is workspace_id, so a dedicated user_id index avoids a scan on that path.
create index if not exists idx_workspace_members_user on workspace_members (user_id);
