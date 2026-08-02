-- FX rates: keep HISTORY instead of only today's snapshot.
--
-- WHY: fx_rates was keyed on `currency` alone and the daily cron upserts onConflict:"currency", so
-- every morning's rates OVERWRITE the previous day's. There is no way to ask what USD→PLN was on
-- 12 June — that data is destroyed daily.
--
-- The consequence is bigger than a missing lookup: every money figure is converted at READ time
-- using TODAY's rate, so historical reports silently change every morning. June's revenue in PLN is
-- a different number today than it was yesterday, and no report can be reproduced or audited.
--
-- A rate is a fact about a DAY, so the key is (currency, as_of). Nothing is deleted: the existing
-- row per currency is already stamped with its own as_of and simply becomes the first day of
-- history. Idempotent — safe to re-run.

-- 1. Re-key on (currency, as_of).
do $$
declare
  pk_name text;
begin
  select conname into pk_name
    from pg_constraint
   where conrelid = 'fx_rates'::regclass and contype = 'p';

  -- Already re-keyed? Then this migration has run; do nothing.
  if pk_name is not null and (
      select count(*) from pg_attribute
       where attrelid = 'fx_rates'::regclass
         and attnum = any((select conkey from pg_constraint where conname = pk_name))
     ) = 2 then
    raise notice 'fx_rates already keyed on (currency, as_of)';
    return;
  end if;

  -- Defensive: a duplicate (currency, as_of) would block the new key. Keep the most recently
  -- written row for each pair. Under the old single-row-per-currency key this finds nothing.
  delete from fx_rates a
   using fx_rates b
   where a.currency = b.currency
     and a.as_of = b.as_of
     and a.ctid < b.ctid;

  if pk_name is not null then
    execute format('alter table fx_rates drop constraint %I', pk_name);
  end if;
  alter table fx_rates add constraint fx_rates_pkey primary key (currency, as_of);
end $$;

-- 2. The hot query is "latest rate for this currency" and "rate for this currency on/before D".
create index if not exists fx_rates_currency_as_of_idx on fx_rates (currency, as_of desc);

-- 3. Provenance: a stored rate must be defensible months later. Existing rows are ECB, which is
--    what the cron has always used (DEFAULT_FX_SOURCE).
alter table fx_rates add column if not exists source text not null default 'ecb';

comment on table fx_rates is
  'FX reference rates per 1 EUR (ECB convention), one row per (currency, as_of) so historical rates survive. Written by the service role only; read for conversion. Fail-closed: no row means conversion returns null, never a guessed rate.';

-- 4. Effective rate on a given date: the most recent quote on or before it. Rates are not published
--    at weekends or holidays, so "the rate on Sunday" is Friday's — carrying forward is correct,
--    inventing one is not. Returns NULL when the date predates all history, which callers must
--    surface rather than silently substituting today's rate.
create or replace function fx_rate_on(p_currency text, p_as_of date)
returns numeric
language sql
stable
as $$
  select rate
    from fx_rates
   where currency = upper(p_currency)
     and as_of <= p_as_of
   order by as_of desc
   limit 1;
$$;

comment on function fx_rate_on(text, date) is
  'Rate per 1 EUR for a currency effective on a date (most recent quote on or before it). NULL when the date predates stored history.';

revoke execute on function fx_rate_on(text, date) from public;
grant execute on function fx_rate_on(text, date) to service_role;
