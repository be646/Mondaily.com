-- Workspace soft-delete: deletion is slow, loud, and reversible for 14 days.
-- deleted_at set → workspace hidden + inert everywhere; hard erase happens via cron after the
-- grace window, with a per-table receipt. Restore inside the window is one click.
alter table workspaces add column if not exists deleted_at timestamptz;
create index if not exists workspaces_deleted_idx on workspaces (deleted_at) where deleted_at is not null;
