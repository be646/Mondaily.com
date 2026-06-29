-- Notifications were silently failing for every agent/workflow/deal-stage event because
-- the inserts carried a `metadata` jsonb (for deep-linking) but the column didn't exist
-- (PGRST204, swallowed). Add it. createNotification() already degrades gracefully without
-- it, so applying this simply turns on context-aware deep-links for new notifications.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
