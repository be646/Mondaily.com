import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { SUPPORTED_CURRENCIES, DEFAULT_BASE_CURRENCY } from "../lib/currency";
import { loadRates, workspaceBaseCurrency, userDisplayCurrency } from "../lib/currency-store";

/**
 * Currency + FX. GET reports the workspace base currency, the caller's display currency, the
 * available currencies, and the stored reference rates (+ the date they're as-of). The base is
 * workspace-wide (owner/admin sets it); display is a per-user view-only override.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const CURRENCY = z.enum(SUPPORTED_CURRENCIES);

router.get("/", async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const [base, display, rates] = await Promise.all([
    workspaceBaseCurrency(ws), userDisplayCurrency(ws, me), loadRates(),
  ]);
  return c.json({
    base, display,
    default_base: DEFAULT_BASE_CURRENCY,
    currencies: SUPPORTED_CURRENCIES,
    rates: rates.rates,          // per 1 EUR
    rates_as_of: rates.as_of,    // null until the daily cron has run against a configured source
  });
});

// POST /currency/base — set the workspace's base (reporting) currency. Owner/admin only.
router.post("/base", requireAdminRole, zValidator("json", z.object({ currency: CURRENCY })), async (c) => {
  const ws = c.get("workspaceId");
  const { data: row } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = { ...((row?.settings ?? {}) as Record<string, unknown>), base_currency: c.req.valid("json").currency };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", ws);
  if (error) return c.json({ error: "Could not update the base currency." }, 500);
  return c.json({ ok: true, base: settings.base_currency });
});

// POST /currency/display — set the caller's personal display currency (view-only override).
router.post("/display", zValidator("json", z.object({ currency: CURRENCY })), async (c) => {
  const ws = c.get("workspaceId"); const me = c.get("userId");
  const { data: row } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = ((row?.settings ?? {}) as Record<string, unknown>);
  const prefs = { ...((settings.user_preferences as Record<string, Record<string, unknown>> | undefined) ?? {}) };
  prefs[me] = { ...(prefs[me] ?? {}), display_currency: c.req.valid("json").currency };
  const { error } = await supabase.from("workspaces").update({ settings: { ...settings, user_preferences: prefs } }).eq("id", ws);
  if (error) return c.json({ error: "Could not update your display currency." }, 500);
  return c.json({ ok: true, display: c.req.valid("json").currency });
});

export { router as currencyRouter };
