-- FIX for 20260804_rate_limits.sql — the function installed cleanly and failed at CALL time.
--
-- `returns table (hits integer, locked_until timestamptz)` declares OUT parameters named `hits` and
-- `locked_until`. The body then said `returning r.hits, r.locked_until into hits, locked_until`,
-- where `hits` is BOTH an output parameter and a column of rate_limits. Postgres resolves that as
-- ambiguous — but only when the function RUNS. So "Success. No rows returned" was true and told us
-- nothing, and every call errored.
--
-- Measured after applying the first migration: fifteen rapid requests to a 12-per-minute endpoint
-- still all returned 200, because the API fail-softs on RPC error and fell back to the in-memory
-- limiter. Silent, which is the worst property a security control can have.
--
-- This is the same defect as the document-numbering function: a plpgsql parameter sharing a column
-- name is ambiguous at call time, and a successful CREATE proves nothing.
--
-- Fix: name the outputs so they cannot collide, and qualify every column reference.

drop function if exists rate_limit_hit(text, integer, timestamptz);

create function rate_limit_hit(
  p_key       text,
  p_window_ms integer,
  p_now       timestamptz default now()
) returns table (out_hits integer, out_locked_until timestamptz)
language plpgsql
as $$
declare
  v_cutoff timestamptz := p_now - make_interval(secs => p_window_ms / 1000.0);
  v_hits   integer;
  v_locked timestamptz;
begin
  insert into rate_limits as r (key, hits, window_start)
  values (p_key, 1, p_now)
  on conflict (key) do update
    -- Window expired → start a new one at 1. Still inside it → increment.
    set hits         = case when r.window_start < v_cutoff then 1 else r.hits + 1 end,
        window_start = case when r.window_start < v_cutoff then p_now else r.window_start end
  returning r.hits, r.locked_until into v_hits, v_locked;

  out_hits := v_hits;
  out_locked_until := v_locked;
  return next;
end;
$$;

-- Prove it runs, not just that it compiles. If this SELECT errors, the migration has not worked —
-- which is exactly what the previous one could not tell you.
select * from rate_limit_hit('migration-selftest', 60000);
select rate_limit_clear('migration-selftest');
