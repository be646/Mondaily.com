-- Discovery cache — memoizes SearXNG search results and scraped page markdown so repeat searches,
-- monitors, and the coach don't re-hit the (rate-limited) engines or re-scrape pages. Purely
-- additive; the code is fail-open (a missing table or any error just fetches fresh).
CREATE TABLE IF NOT EXISTS discovery_cache (
  key         text PRIMARY KEY,           -- e.g. "search:qwant,yahoo:<query>" or "scrape:d:<url>"
  kind        text NOT NULL,              -- 'search' | 'scrape'
  value       jsonb NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discovery_cache_expires ON discovery_cache (expires_at);
