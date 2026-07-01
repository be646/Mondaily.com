import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { inngest } from "../lib/inngest";
import { sovereignHeaders } from "../lib/sovereign-search";

/**
 * Social listening & intent discovery.
 *
 * POST /api/v1/discovery/run fires the async social-discovery worker (sweeps the
 * open web for buyer-intent signals / reviews and upserts grounded results into
 * discovered_leads). GET /api/v1/discovery reads this workspace's results.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

const runSchema = z.object({
  searchType: z.enum(["INTENT_LEADS", "REVIEWS"]),
  sector: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  targetSubject: z.string().max(160).optional(),
});

// Fire the discovery sweep asynchronously (Inngest). Returns immediately — the
// worker writes results to discovered_leads, which GET / below reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function triggerSweep(c: any) {
  const body = c.req.valid("json") as z.infer<typeof runSchema>;
  if (body.searchType === "REVIEWS" && !body.targetSubject) {
    return c.json({ error: "targetSubject is required for a REVIEWS sweep." }, 400);
  }
  await inngest.send({
    name: "app/social.discovery.trigger",
    data: {
      workspaceId: c.get("workspaceId") as string,
      searchType: body.searchType,
      sector: body.sector,
      region: body.region,
      targetSubject: body.targetSubject,
    },
  });
  return c.json({ queued: true }, 202);
}

router.post("/trigger", zValidator("json", runSchema), triggerSweep);
router.post("/run", zValidator("json", runSchema), triggerSweep); // alias used by the Discovery page

// Read discovered leads for this workspace, optionally filtered by intent_type.
router.get("/", async (c) => {
  const intent = c.req.query("intent_type");
  let q = supabase
    .from("discovered_leads")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false })
    .limit(200);
  if (intent) q = q.eq("intent_type", intent);
  const { data, error } = await q;
  if (error) {
    // Most likely the discovered_leads migration isn't applied yet. Degrade
    // gracefully to an empty feed rather than 500-ing the page.
    console.error("[discovery] read failed (returning empty):", error.message);
    return c.json([]);
  }
  return c.json(data ?? []);
});

// Lightweight setup probe so the UI can show a clear "configure discovery" state
// instead of a silently-empty feed. Reports whether the web-search key is set.
// Read-only diagnostic probe for the self-hosted search stack. Two shallow GETs
// with a hard 3s timeout each so a down service can't block the request. Any
// connection error / timeout → that service is `false` and the overall status is
// DEGRADED; the route never throws.
// Returns the outcome so /status can distinguish "can't connect" (env/network) from
// "401 auth failing" (SOVEREIGN_SEARCH_KEY missing/mismatched) — very different fixes.
async function probe(url: string): Promise<{ reachable: boolean; ok: boolean; code: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: sovereignHeaders() });
    return { reachable: true, ok: res.ok, code: res.status };
  } catch {
    return { reachable: false, ok: false, code: 0 };
  } finally {
    clearTimeout(timer);
  }
}

router.get("/status", async (c) => {
  const searchUrl = process.env.SOVEREIGN_SEARCH_URL || "http://localhost:8080/search";
  const scrapeUrl = process.env.SOVEREIGN_SCRAPE_URL || "http://localhost:3002/v1/scrape";
  const searchHealth = searchUrl.replace(/\/search\/?$/, "/healthz");
  const scrapeHealth = scrapeUrl.replace(/\/v[12]\/scrape\/?$/, "/health").replace(/\/scrape\/?$/, "/health");

  const [search, scrape] = await Promise.all([probe(searchHealth), probe(scrapeHealth)]);
  // "reachable" for the UI = actually usable (200). A 401 or a connection failure both mean
  // sweeps won't work, so both surface as degraded (with a precise diagnostic below).
  const searxng_reachable = search.ok;
  const scraper_reachable = scrape.ok;

  const diagnostic =
    !search.reachable ? "Can't reach the appliance — check SOVEREIGN_SEARCH_URL in the API env (it may be falling back to localhost) and that the box is online."
    : search.code === 401 ? "Appliance is up but rejecting requests (401) — SOVEREIGN_SEARCH_KEY is missing or doesn't match the appliance's token. Set it in the API env and redeploy."
    : searxng_reachable && scraper_reachable ? "All systems operational."
    : `Search ${search.code}, scrape ${scrape.code}.`;

  return c.json({
    status: searxng_reachable && scraper_reachable ? "HEALTHY" : "DEGRADED",
    services: { searxng_reachable, scraper_reachable },
    // Env-configured flags + codes so the exact failure is visible from the client/logs.
    configured: { search_url: Boolean(process.env.SOVEREIGN_SEARCH_URL), scrape_url: Boolean(process.env.SOVEREIGN_SCRAPE_URL), search_key: Boolean(process.env.SOVEREIGN_SEARCH_KEY) },
    codes: { search: search.code, scrape: scrape.code },
    diagnostic,
  });
});

export { router as discoveryRouter };
