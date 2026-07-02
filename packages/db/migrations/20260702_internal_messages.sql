-- Internal Mondaily messaging — workspace-scoped member-to-member messages.
-- Replaces the old `mailto:` "Message member" action (which opened the OS mail app) with
-- a real, persisted, in-app inbox. One row per message; a thread is a stable pair-key so
-- one-to-one conversations group without a separate threads table. Purely additive.
--
-- Notifications reuse the existing `notifications` table (type = 'message'); nothing here
-- touches auth, billing, or existing data.

CREATE TABLE IF NOT EXISTS internal_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  -- pair-key: the two member user_ids sorted + joined with ':' so both directions share a thread
  thread_key    text NOT NULL,
  sender_id     text NOT NULL,
  recipient_id  text NOT NULL,
  body          text NOT NULL,
  read_at       timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Inbox / thread reads are always scoped to (workspace, a member, time).
CREATE INDEX IF NOT EXISTS idx_internal_messages_ws_recipient ON internal_messages (workspace_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_messages_ws_thread    ON internal_messages (workspace_id, thread_key, created_at);
CREATE INDEX IF NOT EXISTS idx_internal_messages_ws_sender    ON internal_messages (workspace_id, sender_id, created_at DESC);

-- Per-PARTICIPANT thread state. Archive is a personal view choice, so it must NOT live on the
-- shared message rows (one user archiving would hide the thread for the other). Each user gets
-- their own row per thread with their own archived_at / last_read_at. Purely additive.
CREATE TABLE IF NOT EXISTS internal_message_thread_state (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  thread_key    text NOT NULL,
  user_id       text NOT NULL,
  archived_at   timestamptz,
  last_read_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, thread_key, user_id)
);
CREATE INDEX IF NOT EXISTS idx_imts_ws_user ON internal_message_thread_state (workspace_id, user_id);
