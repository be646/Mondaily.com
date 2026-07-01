import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { requireAuth } from "../middleware/auth";
import { inngest } from "../lib/inngest";
import { sovereignHeaders } from "../lib/sovereign-search";
import { runSocialDiscovery } from "../jobs/social-discovery";
import { aiGatewayToolUse } from "../lib/ai-gateway";

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

// Run the discovery sweep. We run it DIRECTLY (await) so results are populated even if the
// Inngest worker isn't processing events in this environment — plus fire the Inngest event as
// a best-effort background path. The direct run is what actually makes the page fill.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function triggerSweep(c: any) {
  const body = c.req.valid("json") as z.infer<typeof runSchema>;
  if (body.searchType === "REVIEWS" && !body.targetSubject) {
    return c.json({ error: "targetSubject is required for a REVIEWS sweep." }, 400);
  }
  const params = {
    workspaceId: c.get("workspaceId") as string,
    searchType: body.searchType,
    sector: body.sector,
    region: body.region,
    targetSubject: body.targetSubject,
  };
  // Best-effort background event (no-op if Inngest isn't wired) — never blocks the direct run.
  inngest.send({ name: "app/social.discovery.trigger", data: params }).catch(() => {});
  try {
    const result = await runSocialDiscovery(params);
    return c.json({ ok: true, ...result }, 200);
  } catch (e) {
    console.error("[discovery] direct sweep failed:", e instanceof Error ? e.message : e);
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Sweep failed" }, 200);
  }
}

router.post("/trigger", zValidator("json", runSchema), triggerSweep);
router.post("/run", zValidator("json", runSchema), triggerSweep); // alias used by the Discovery page

// POST /discovery/search { query } — the single-box "Google-style" entry point. One free-text
// query; the AI classifies it into the structured sweep params (searchType/sector/region/subject)
// instead of the user filling out a form. Never invents the query's meaning beyond what's asked —
// if a target subject genuinely isn't present for a reviews-style ask, it falls back to leads.
const searchSchema = z.object({ query: z.string().min(2).max(300) });
router.post("/search", zValidator("json", searchSchema), async (c) => {
  const { query } = c.req.valid("json");
  let classified: { searchType?: string; sector?: string; region?: string; targetSubject?: string } = {};
  try {
    classified = await aiGatewayToolUse({
      toolName: "classify_discovery_query",
      toolDescription: "Classify a free-text web-discovery search into structured sweep parameters",
      toolSchema: {
        type: "object",
        properties: {
          searchType: { type: "string", enum: ["INTENT_LEADS", "REVIEWS"], description: "REVIEWS if the user is asking what people say/think about a specific named person/company/product (reviews, opinions, reputation). INTENT_LEADS if the user wants to FIND people/businesses in a sector (prospects, leads, directories)." },
          sector: { type: "string", description: "The industry/sector/subject-matter, e.g. 'real estate', 'aesthetic clinics', 'SaaS companies'. Omit if not applicable." },
          region: { type: "string", description: "A geographic location mentioned, e.g. 'London', 'Austin TX'. Omit if none mentioned." },
          targetSubject: { type: "string", description: "REQUIRED for REVIEWS — the specific person/company/product being asked about, e.g. 'Vivacy', 'Acme Corp'." },
        },
        required: ["searchType"],
      },
      system: "You classify a Mondaily Discovery search query into structured parameters. Be precise: REVIEWS needs one specific named subject; if the query names no specific entity, it's INTENT_LEADS (finding prospects in a sector/region) even if the word 'review' appears generically.",
      prompt: query,
      maxTokens: 200,
    }).catch(() => ({} as Record<string, unknown>));
  } catch { /* fall through to heuristic below */ }

  const searchType = classified.searchType === "REVIEWS" && classified.targetSubject ? "REVIEWS" : "INTENT_LEADS";
  const params = {
    workspaceId: c.get("workspaceId") as string,
    searchType: searchType as "INTENT_LEADS" | "REVIEWS",
    sector: classified.sector || (searchType === "INTENT_LEADS" ? query : undefined),
    region: classified.region,
    targetSubject: classified.targetSubject,
  };
  inngest.send({ name: "app/social.discovery.trigger", data: params }).catch(() => {});
  try {
    const result = await runSocialDiscovery(params);
    return c.json({ ok: true, classified: params, ...result }, 200);
  } catch (e) {
    console.error("[discovery] search sweep failed:", e instanceof Error ? e.message : e);
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Sweep failed" }, 200);
  }
});

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

  const hasSearchUrl = Boolean(process.env.SOVEREIGN_SEARCH_URL);
  const hasKey = Boolean(process.env.SOVEREIGN_SEARCH_KEY);
  const diagnostic =
    !hasSearchUrl ? "SOVEREIGN_SEARCH_URL is NOT present on this API deployment — it's on the wrong Vercel project (must be the API/backend project, the one serving api.mondaily.com — not the app frontend), or this deploy is older than the variable. Set it on the API project and redeploy."
    : !search.reachable ? `SOVEREIGN_SEARCH_URL is set (to '${searchUrl}') but the appliance isn't reachable from the API — verify the value is exactly http://167.233.204.196:8080/search and the box is online.`
    : search.code === 401 || !hasKey ? "Appliance is up but rejecting requests (401) — SOVEREIGN_SEARCH_KEY is missing or doesn't match the appliance's token. Set it on the API project and redeploy."
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
