-- Atomic document numbering for invoices and quotes.
--
-- Both were numbered by reading the highest existing number and adding one. Two creates that
-- overlap read the same maximum and mint the same number: for an invoice that is not a cosmetic
-- bug, it is two different documents claiming one identity in the customer's records and in ours.
--
-- There is a second, quieter bug in the same function. The read ordered by `data->>number`, which
-- is a TEXT sort, and the number is padded to four digits. That agrees with numeric order only up
-- to 9999: 'INV-9999' sorts above 'INV-10000', so the ten-thousandth document would restart the
-- sequence and collide with numbers already issued.
--
-- A counter row per (workspace, document type) fixes both. The increment happens inside one
-- statement, so concurrency is the database's problem rather than ours, and the value is an
-- integer, so ordering is arithmetic and padding is only a display choice.

create table if not exists document_counters (
  workspace_id text not null,
  doc_type     text not null,
  next_value   bigint not null default 1,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, doc_type)
);

alter table document_counters enable row level security;
-- Reached only through the security-definer function below, which is granted to the API role.
revoke all on document_counters from public, anon, authenticated;

-- Parameters are p_-prefixed. `doc_type` as a bare parameter name is AMBIGUOUS against the column
-- of the same name in the ON CONFLICT target, and plpgsql raises at call time, not at create time
-- so the function installs cleanly and then fails on every single call.
drop function if exists next_document_number(text, text, bigint);

/**
 * Claim the next number for a document type, atomically.
 *
 * `p_seed` carries the highest number already in use, so an existing workspace continues its
 * series instead of restarting at 1 and colliding with every document it has already issued. It is
 * applied with GREATEST on every call rather than only at creation: a workspace that imported
 * documents after the counter existed would otherwise mint numbers that are already taken.
 */
create or replace function next_document_number(
  p_ws text,
  p_doc_type text,
  p_seed bigint default 0
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed bigint;
begin
  -- The invariant: after this statement the row holds the number the NEXT caller will take, and
  -- this caller returns that minus one. Both branches are written to satisfy it.
  --
  --   insert (first ever call): claim seed+1, so store seed+2
  --   update (every later call): claim GREATEST(stored, seed+1), so store that plus one
  --
  -- GREATEST on the update branch is what makes it safe under concurrency and under a later
  -- import: the counter can only ever move forward, never back onto a number already issued.
  insert into document_counters as dc (workspace_id, doc_type, next_value)
  values (p_ws, p_doc_type, greatest(p_seed, 0) + 2)
  on conflict (workspace_id, doc_type) do update
    set next_value = greatest(dc.next_value, greatest(p_seed, 0) + 1) + 1,
        updated_at = now()
  returning dc.next_value - 1 into claimed;

  return claimed;
end;
$$;

revoke all on function next_document_number(text, text, bigint) from public, anon, authenticated;
grant execute on function next_document_number(text, text, bigint) to service_role;
