-- Per-user read state for workspace-wide notifications.
--
-- A notification with `user_id IS NULL` is addressed to everyone in the workspace, but its read
-- state lived in `is_read`/`read_at` on that single shared row. So the first member to open the
-- bell marked it read for the whole team, and everyone else silently lost a notification they were
-- meant to see. The bug is invisible from the inside: nothing errors, the notification simply is
-- not there any more.
--
-- Read state for a shared row is per-reader, so it belongs in its own table rather than on the
-- notification. Personal notifications (user_id set) keep using is_read on the row: they have
-- exactly one reader, the column is already correct for them, and rewriting that would mean
-- migrating existing data to fix something that was never broken.

create table if not exists notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id         text not null,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- The lookup is always "which of these notifications has this user read", so user_id leads.
create index if not exists notification_reads_user_idx
  on notification_reads (user_id, notification_id);

alter table notification_reads enable row level security;
-- Reached only through the API, which scopes every read and write by the authenticated user.
revoke all on notification_reads from public, anon, authenticated;
grant select, insert, delete on notification_reads to service_role;
