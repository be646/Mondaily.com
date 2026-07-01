-- Capture EVERY distinct discovered lead/review, not just one per URL.
-- The old `source_url text UNIQUE` (a) collapsed all reviews on one page into a single row, and
-- (b) was GLOBAL — two workspaces couldn't discover the same URL. Replace it with a per-workspace
-- fingerprint (url + author + content snippet): multiple reviews from the same page are all stored,
-- while re-scanning the same review updates it in place (no duplicates).

ALTER TABLE discovered_leads DROP CONSTRAINT IF EXISTS discovered_leads_source_url_key;
ALTER TABLE discovered_leads ADD COLUMN IF NOT EXISTS fingerprint text;

-- Backfill existing rows so the unique index can be built.
UPDATE discovered_leads
SET fingerprint = md5(coalesce(source_url, '') || '|' || coalesce(author_name, ''))
WHERE fingerprint IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS discovered_leads_ws_fingerprint_idx
  ON discovered_leads (workspace_id, fingerprint);
