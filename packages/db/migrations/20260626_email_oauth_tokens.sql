-- Direct-provider email OAuth (Gmail API, later Microsoft Graph) — replaces the
-- Nylas grant model. We now store the provider's own OAuth tokens on
-- email_connections instead of a Nylas grant_id.
--
-- grant_id is made nullable (Nylas-only); Google connections use refresh_token.
alter table email_connections
  add column if not exists refresh_token text,   -- long-lived; used to mint access tokens
  add column if not exists access_token  text,   -- short-lived cache (~1h)
  add column if not exists token_expiry  timestamptz;

alter table email_connections alter column grant_id drop not null;
