-- Align notifications table with API/frontend expectations.
-- Adds title, body, is_read, task_id columns so the API can use them directly.
-- Existing rows keep message/record_name; new rows will use title/body.

alter table notifications
  add column if not exists title     text,
  add column if not exists body      text,
  add column if not exists is_read   boolean not null default false,
  add column if not exists task_id   uuid;

-- Backfill: copy message → title for existing rows
update notifications set title = message where title is null;

-- Index for fast unread queries
create index if not exists notifications_workspace_unread_idx
  on notifications (workspace_id, user_id, is_read, created_at desc);
