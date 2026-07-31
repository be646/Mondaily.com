-- TOTP two-factor auth (opt-in per user). Secret + hashed recovery codes live on the
-- credential row; enabled only when totp_enabled_at is set (a pending secret alone does nothing,
-- so an interrupted enrollment can never lock anyone out).
alter table auth_credentials add column if not exists totp_secret text;
alter table auth_credentials add column if not exists totp_enabled_at timestamptz;
alter table auth_credentials add column if not exists recovery_codes jsonb;
