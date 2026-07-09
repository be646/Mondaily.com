-- Native-email attachments — a PRIVATE Supabase Storage bucket.
-- Objects are keyed by `<workspaceId>/<messageId>/<i>-<filename>`. The API (service role) writes on
-- inbound and hands out short-lived SIGNED URLs scoped to the caller's workspace prefix, so no
-- tenant can read another's files. Private = never publicly listable/fetchable without a signed URL.
-- Idempotent.

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', false)
ON CONFLICT (id) DO NOTHING;
