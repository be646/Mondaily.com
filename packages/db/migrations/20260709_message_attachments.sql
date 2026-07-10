-- Inbox (member chat) file attachments.
-- 1) A PRIVATE Supabase Storage bucket — objects keyed `<workspaceId>/<senderId>/<ts>-<i>-<name>`;
--    the API (service role) writes on upload and hands out short-lived SIGNED URLs only after
--    verifying the caller participates in the message that references the path. Never public.
-- 2) internal_messages.attachments — metadata array [{path,name,content_type,size}] stored with
--    the message itself, so a thread read needs no extra join. Idempotent.

INSERT INTO storage.buckets (id, name, public)
VALUES ('message-attachments', 'message-attachments', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE internal_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';
