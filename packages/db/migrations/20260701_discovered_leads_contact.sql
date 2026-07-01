-- Richer Discovery: store extracted contact details + a note alongside each discovered lead.
-- A single jsonb column so we can add more contact fields later without another migration.
-- Shape: { "email": "...", "phone": "...", "handle": "@...", "summary": "..." } (any may be null).
alter table if exists discovered_leads
  add column if not exists contact jsonb not null default '{}'::jsonb;
