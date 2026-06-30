-- Email verification for Sovereign Auth credentials.
-- Soft verification: users can still use the app while unverified (a banner nudges them),
-- but the flag lets us gate sensitive actions later and prove email ownership.
alter table if exists auth_credentials
  add column if not exists email_verified boolean not null default false,
  add column if not exists verified_at timestamptz;

-- Existing accounts (pre-feature) are treated as verified so we don't suddenly nag everyone.
update auth_credentials set email_verified = true, verified_at = now()
  where email_verified = false and created_at < '2026-06-30';
