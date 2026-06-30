-- ── Active-session telemetry ──────────────────────────────────────────────
-- Capture the client IP + a rolling last-seen on each refresh-token row so the
-- Security panel's Active Sessions grid renders real device/IP/last-active data.
-- (Code inserts these defensively — login still works before this runs — but run
--  it so the columns actually persist.)
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- ── Persisted Proof-of-Work claims ────────────────────────────────────────
-- Absolute cryptographic legitimacy signal for the ABI matrix: one row per time a
-- user's session solves the SHA-256 zero-nonce puzzle. Replaces the session proxy.
CREATE TABLE IF NOT EXISTS pow_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text NOT NULL,
  challenge_hash text NOT NULL,
  nonce          text NOT NULL,
  context        text,                       -- 'register' | 'reset' | 'activate' | 'session'
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pow_claims_user_idx ON pow_claims (user_id, created_at DESC);
ALTER TABLE pow_claims ENABLE ROW LEVEL SECURITY;
