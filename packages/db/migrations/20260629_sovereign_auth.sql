-- Sovereign Auth — native credentials + DB-backed refresh tokens. Built ALONGSIDE Clerk
-- (shadow mode): nothing reads these tables until cutover, so applying this is zero-risk.
--
-- Canonical identity is preserved: auth_credentials.user_id holds the SAME user_… id already
-- used across workspace_members / created_by / actor_id / owner_id (2,300+ rows), so activating
-- a legacy account binds a password to the existing id and the whole graph stays intact.

-- Credentials store — one row per human identity. Password is a memory-hard scrypt digest
-- (self-describing: scrypt$N$r$p$salt$hash), never plaintext.
CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id       text PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_credentials_email_uidx ON auth_credentials (lower(email));

-- DB-backed refresh tokens — we store only the SHA-256 of each token (never the raw value),
-- support rotation (replaced_by) and revocation (revoked_at).
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  replaced_by uuid,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS auth_refresh_tokens_hash_idx ON auth_refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS auth_refresh_tokens_user_idx ON auth_refresh_tokens (user_id);

-- These are touched ONLY by the service-role API. Lock out anon/authenticated entirely
-- (service role bypasses RLS, so the API is unaffected; no policies = no other access).
ALTER TABLE auth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_refresh_tokens ENABLE ROW LEVEL SECURITY;
