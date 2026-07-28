-- Reconcile prod drift: task_attachments.
--
-- supabase/migrations/0014_tasks_and_detail_tables.sql declares
--   (id, task_id, workspace_id, name, url, size, mime_type, uploaded_by, created_at)
-- but PRODUCTION rejects writes to `name` and `mime_type`:
--   "Could not find the 'name' column of 'task_attachments' in the schema cache"
-- The table exists (GET /tasks/:id/attachments returns 200 []), so it was created with a
-- different shape than 0014 describes. Consequence: BOTH attachment write paths 500'd, and
-- the UI swallowed it — attaching a file to a task silently did nothing, for everyone.
--
-- Additive and idempotent: adds only what's missing, touches no existing data.
alter table task_attachments add column if not exists name        text;
alter table task_attachments add column if not exists url         text;
alter table task_attachments add column if not exists size        bigint;
alter table task_attachments add column if not exists mime_type   text;
alter table task_attachments add column if not exists uploaded_by text;
alter table task_attachments add column if not exists created_at  timestamptz not null default now();

-- If the drifted table used file_* names, carry any existing rows over before the app
-- switches to the canonical columns. No-ops when those columns don't exist.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'task_attachments' and column_name = 'file_name') then
    update task_attachments set name = coalesce(name, file_name),
                                url  = coalesce(url,  file_url)
     where name is null or url is null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_name = 'task_attachments' and column_name = 'file_size') then
    update task_attachments set size = coalesce(size, file_size) where size is null;
  end if;
end $$;
