-- Inbox group chats. Groups are workspace-scoped; membership is explicit (chat_group_members).
-- Group messages reuse internal_messages with group_id set and recipient_id NULL — the same
-- attachments/read-state machinery applies. Access is ALWAYS by membership, never by role.
-- Idempotent.

CREATE TABLE IF NOT EXISTS chat_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name         text NOT NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_groups_ws ON chat_groups (workspace_id);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id     uuid NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id      text NOT NULL,
  added_by     text NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cgm_user ON chat_group_members (workspace_id, user_id);

ALTER TABLE internal_messages ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE internal_messages ALTER COLUMN recipient_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_im_group ON internal_messages (workspace_id, group_id, created_at);
