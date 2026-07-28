-- Private storage bucket for task attachments.
--
-- POST /api/v1/tasks/:id/upload writes objects here under `<workspace_id>/<task_id>/<file>`,
-- and downloads are served through short-lived signed URLs scoped to that workspace prefix —
-- so one tenant can never read another's files. Mirrors `message-attachments`.
--
-- Until this runs, uploads fail with an honest "Couldn't store …" error (the route surfaces
-- the storage message) rather than silently doing nothing, which is what happened before.

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

-- No public policies on purpose: the API uses the service role and hands out signed URLs.
