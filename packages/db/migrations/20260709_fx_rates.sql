-- FX reference rates — global (not workspace-scoped), quoted as units-per-1-EUR (ECB convention).
-- Refreshed by a daily cron from a configurable public source (FX_RATES_URL, default ECB). At
-- request time the app reads ONLY this table — never a live third-party FX call. Fail-closed: an
-- empty table means conversion returns null and the UI shows "rate unavailable", never a fake rate.
-- Written by the service role only; readable for conversion. Idempotent.

CREATE TABLE IF NOT EXISTS fx_rates (
  currency   text PRIMARY KEY,             -- ISO 4217, e.g. USD, GBP, PLN (per 1 EUR)
  rate       numeric NOT NULL,
  as_of      date NOT NULL,                -- the date the rate is quoted for
  updated_at timestamptz NOT NULL DEFAULT now()
);
