-- Sovereign error sink.
--
-- Production exceptions were invisible. The app's ErrorBoundary caught a render error, wrote
-- console.error into a browser nobody was watching, and showed a recovery card — so unless a user
-- reported it, nothing did. Three defects found by audit on 2026-08-04 were silent failures of
-- exactly that shape: a limiter that had stopped limiting, an onboarding checklist that could never
-- tick, an agent overwriting human data. Each looked like a 200.
--
-- No hosted APM: our own table, our own Postgres, consistent with everything else here.
--
-- DEDUPED BY FINGERPRINT rather than storing one row per occurrence. One broken page can throw on
-- every render; a table that grows per-render is a self-inflicted outage and would bury the signal
-- in its own noise. Same error → one row, a count, and first/last seen.

create table if not exists client_errors (
  fingerprint   text primary key,
  message       text        not null,
  source        text        not null default 'client',   -- client | api
  route         text,
  occurrences   integer     not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  -- Best-effort context. Nullable on purpose: an error thrown before auth resolves has no
  -- workspace, and losing the report would defeat the point.
  workspace_id  uuid,
  release        text,
  user_agent    text,
  -- Cleared by an operator once handled, so the list is a WORKLIST and not an archive.
  resolved_at   timestamptz
);

create index if not exists client_errors_last_seen_idx on client_errors (last_seen_at desc);
create index if not exists client_errors_unresolved_idx on client_errors (resolved_at) where resolved_at is null;

/**
 * Record one occurrence.
 *
 * Atomic upsert: two tabs throwing the same error at the same moment must not race to insert the
 * same primary key. Returns the running total so the caller can tell "first ever" from "again".
 */
create or replace function client_error_report(
  p_fingerprint text,
  p_message     text,
  p_source      text,
  p_route       text,
  p_workspace   uuid,
  p_release     text,
  p_user_agent  text
) returns table (out_occurrences integer, out_first_seen timestamptz)
language plpgsql
as $$
declare
  v_occ   integer;
  v_first timestamptz;
begin
  insert into client_errors as e
    (fingerprint, message, source, route, workspace_id, release, user_agent)
  values
    (p_fingerprint, left(p_message, 2000), coalesce(p_source, 'client'), left(p_route, 300),
     p_workspace, left(p_release, 80), left(p_user_agent, 300))
  on conflict (fingerprint) do update
    set occurrences  = e.occurrences + 1,
        last_seen_at = now(),
        -- A recurrence after someone marked it handled is NOT handled.
        resolved_at  = null
  returning e.occurrences, e.first_seen_at into v_occ, v_first;

  out_occurrences := v_occ;
  out_first_seen  := v_first;
  return next;
end;
$$;

-- Prove it RUNS, not merely that it compiles. The rate-limit function installed cleanly and failed
-- at call time because an OUT parameter shared a column name; a green CREATE proved nothing.
select * from client_error_report('selftest', 'migration self-test', 'api', '/selftest', null, null, null);
delete from client_errors where fingerprint = 'selftest';
