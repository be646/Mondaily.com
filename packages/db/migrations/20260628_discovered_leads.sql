-- Social-listening / intent-discovery results.
--
-- The social-discovery Inngest worker (jobs/social-discovery.ts) sweeps the open
-- web (Reddit, X, Google Reviews, …) for buyer-intent signals and reviews, runs
-- them through the sovereign Cerebras gateway for grounded extraction, and upserts
-- the clean results here (deduped on source_url).
--
-- SECURITY: written server-side only (service-role key). RLS is enabled with NO
-- client policy — only the service role (which bypasses RLS) may read/write.
CREATE TABLE IF NOT EXISTS discovered_leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_url       text UNIQUE,
  platform         text,                       -- 'X' | 'Reddit' | 'Google Reviews' | …
  author_name      text,
  raw_content      text,
  intent_type      text CHECK (intent_type IN ('BUY_SIGNAL', 'REVIEW', 'COMPLAINT')),
  target_subject   text,                       -- for reviews of a specific person/company
  region           text,
  confidence_score integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- High-performance compound index for the per-tenant, per-intent feed queries.
CREATE INDEX IF NOT EXISTS idx_discovered_leads_ws_intent ON discovered_leads (workspace_id, intent_type);

ALTER TABLE discovered_leads ENABLE ROW LEVEL SECURITY;
-- (intentionally no GRANT/POLICY — service role only)
