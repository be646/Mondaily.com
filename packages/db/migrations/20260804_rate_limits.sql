-- Durable rate limiting / login lockout.
--
-- The API's limiter and its escalating login lockout were both in-memory Maps. Both files said so
-- and both said to back them with Postgres. On Vercel that is not a soft limitation: each request
-- may land on a different serverless instance, so the counters never accumulate. Measured against
-- production on 2026-08-04, fifteen rapid requests to a 12-per-minute endpoint all returned 200.
--
-- That left login brute-force protection resting entirely on the proof-of-work gate. PoW is real —
-- it costs the attacker CPU per attempt — but the rate limit and the account lockout the code
-- believed it had were absent in production.
--
-- One table, keyed by whatever the caller wants to count (route|ip|email), with a fixed window.
-- Sovereign: our own Postgres, no third-party limiter service.

create table if not exists rate_limits (
  key           text primary key,
  hits          integer     not null default 0,
  window_start  timestamptz not null default now(),
  -- Set when a caller trips an escalating lockout (bad passwords), separate from the rolling
  -- window so a lockout survives the window resetting underneath it.
  locked_until  timestamptz
);

create index if not exists rate_limits_window_idx on rate_limits (window_start);

/**
 * Count one hit and report the state, atomically.
 *
 * Returns the hit count INSIDE the current window and any active lock. A single statement so two
 * concurrent requests cannot both read "1 hit" and both proceed — the exact race an in-memory Map
 * on one instance never had to think about and a shared table absolutely does.
 */
create or replace function rate_limit_hit(
  p_key       text,
  p_window_ms integer,
  p_now       timestamptz default now()
) returns table (hits integer, locked_until timestamptz)
language plpgsql
as $$
declare
  v_cutoff timestamptz := p_now - make_interval(secs => p_window_ms / 1000.0);
begin
  insert into rate_limits as r (key, hits, window_start)
  values (p_key, 1, p_now)
  on conflict (key) do update
    -- Window expired → start a new one at 1. Still inside it → increment.
    set hits         = case when r.window_start < v_cutoff then 1 else r.hits + 1 end,
        window_start = case when r.window_start < v_cutoff then p_now else r.window_start end
  returning r.hits, r.locked_until into hits, locked_until;
  return next;
end;
$$;

/** Place an explicit lock on a key (the escalating login lockout). */
create or replace function rate_limit_lock(
  p_key   text,
  p_ms    integer,
  p_now   timestamptz default now()
) returns void
language plpgsql
as $$
begin
  insert into rate_limits as r (key, hits, window_start, locked_until)
  values (p_key, 0, p_now, p_now + make_interval(secs => p_ms / 1000.0))
  on conflict (key) do update
    set locked_until = p_now + make_interval(secs => p_ms / 1000.0),
        hits = 0;
end;
$$;

/** Clear a key — called on a successful login so a good password forgives past failures. */
create or replace function rate_limit_clear(p_key text) returns void
language sql
as $$
  delete from rate_limits where key = p_key;
$$;
