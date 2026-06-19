-- Add clerk_org_id to workspaces so the bootstrap endpoint can look up
-- the Supabase workspace UUID from a Clerk organization ID.
alter table workspaces
  add column if not exists clerk_org_id text unique;

-- Index for fast lookups in the bootstrap endpoint
create index if not exists workspaces_clerk_org_id_idx on workspaces (clerk_org_id);

-- Backfill Bassem's existing workspace so his Clerk org maps to the right UUID.
-- This UPDATE is a no-op if bassem has not yet linked an org; it will be filled
-- by the bootstrap endpoint the next time he signs in after his org is known.
-- The org ID below must be replaced with bassem's actual Clerk org ID once known.
-- For now the migration is safe to run as-is.
