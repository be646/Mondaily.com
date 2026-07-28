-- Live Multilingual Meeting Intelligence — Phase C.1: translated transcript overlay (member, Transcript tab).
-- A per-(workspace, source-text, source-lang, target-lang) CACHE of sovereign-gateway translations. This is
-- a READ-TIME OVERLAY only: it NEVER touches call_transcript_lines (the original transcript stays the sole
-- saved record). Idempotent by the unique key so an identical line/target is translated at most once, and
-- repeated/short lines are ~free after warmup. Additive + fail-open (a missing table just misses the cache).

CREATE TABLE IF NOT EXISTS caption_translations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  text_hash       text NOT NULL,                     -- sha256 of the normalized source text
  source_lang     text NOT NULL,                     -- detected source lang, or 'auto' when unknown
  target_lang     text NOT NULL,                     -- requested target language
  translated_text text NOT NULL,                     -- the gateway's translation (never fabricated; misses aren't stored)
  model           text,                              -- non-secret model label for observability
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT caption_translations_uniq UNIQUE (workspace_id, text_hash, source_lang, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_caption_translations_lookup ON caption_translations (workspace_id, text_hash);
CREATE INDEX IF NOT EXISTS idx_caption_translations_expiry ON caption_translations (expires_at);

-- Server-owned (all reads/writes go through the workspace-scoped /translate route). RLS on with NO policy
-- so anon/authenticated Supabase clients can't touch it directly — same posture as call_transcript_lines.
ALTER TABLE caption_translations ENABLE ROW LEVEL SECURITY;
