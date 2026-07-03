import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { supabase } from "@mondaily/db/client";
import { requireAuth, requireJwt } from "../middleware/auth";
import { inngest } from "../lib/inngest";
import { sovereignHeaders } from "../lib/sovereign-search";
import { runSocialDiscovery, type DiscoveryParams } from "../jobs/social-discovery";
import { objectTypeToVertical } from "./prospecting";
import { denyViewerWrites } from "../middleware/rbac";
import { placesDiagnostic } from "../lib/places";
import { redditDiagnostic } from "../lib/reddit";
import { aiGatewayToolUse } from "../lib/ai-gateway";
import { streamSSE } from "hono/streaming";

/**
 * Social listening & intent discovery.
 *
 * POST /api/v1/discovery/run fires the async social-discovery worker (sweeps the
 * open web for buyer-intent signals / reviews and upserts grounded results into
 * discovered_leads). GET /api/v1/discovery reads this workspace's results.
 */
type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();

// Connector health — registered BEFORE the workspace-requiring requireAuth so you can hit it from
// a browser tab (no X-Workspace-Id header). Auth only (requireJwt); makes one real test call to
// each data source so a bad Google key is visible instead of silently falling back to OSM.
router.get("/connectors", requireJwt, async (c) => {
  const [places, reddit] = await Promise.all([
    placesDiagnostic().catch(() => ({ provider: "osm" as const, ok: true, detail: "probe failed", sample: 0 })),
    redditDiagnostic().catch(() => ({ enabled: false, ok: false, detail: "probe failed" })),
  ]);
  return c.json({ places, reddit });
});

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

// The single-box "Google-style" entry point. One free-text query; the AI classifies it into the
// structured sweep params (searchType/sector/region/subject) instead of the user filling out a
// form. Never invents the query's meaning beyond what's asked — if a target subject genuinely
// isn't present for a reviews-style ask, it falls back to leads.
const searchSchema = z.object({ query: z.string().min(2).max(300), deep: z.boolean().optional() });

async function classifyQuery(workspaceId: string, query: string, deep?: boolean): Promise<DiscoveryParams> {
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
      model: process.env.AI_FAST_MODEL || undefined, // light task → cheap model when configured
      maxTokens: 200,
    }).catch(() => ({} as Record<string, unknown>));
  } catch { /* fall through to heuristic below */ }

  // Heuristic backstop so review intent is never missed when the model is unsure. Phrases like
  // "reviews about X", "opinions on X", "what do people say about X" are unambiguously REVIEWS,
  // and the subject is whatever follows — even lowercase/misspelled (e.g. "ambrorzek klinik warsaw").
  const lc = query.toLowerCase();
  const reviewish = /\b(reviews?|reviewed|opinions?|opinie|complaints?|reputation|feedback|testimonials?|what (do|are) people say|are they (any )?good|legit|scam)\b/.test(lc);
  const heuristicSubject = query
    .replace(/^\s*(reviews?|opinions?|feedback|complaints?|reputation)\s+(about|on|for|of|regarding)\s+/i, "")
    .replace(/^\s*what (do|are) people say(ing)?\s+(about|on)\s+/i, "")
    .trim();

  const isReviews = classified.searchType === "REVIEWS" || reviewish;
  const subject = classified.targetSubject || (isReviews ? heuristicSubject || query : undefined);
  const searchType: "INTENT_LEADS" | "REVIEWS" = isReviews && subject ? "REVIEWS" : "INTENT_LEADS";

  return {
    workspaceId,
    searchType,
    sector: classified.sector || (searchType === "INTENT_LEADS" ? query : undefined),
    region: classified.region,
    targetSubject: searchType === "REVIEWS" ? subject : classified.targetSubject,
    deep,
  };
}

// SEARCH COACH — a fast, cheap pre-flight that judges whether a query is specific enough to run a
// good (expensive) sweep. Vague queries ("leads in warsaw") get a coaching message + clickable
// suggestions instead of wasting a full search. Specific queries pass straight through.
router.post("/coach", zValidator("json", z.object({ query: z.string().min(1).max(300) })), async (c) => {
  const { query } = c.req.valid("json");
  try {
    const out = await aiGatewayToolUse({
      toolName: "assess_search_query",
      toolDescription: "Judge if a lead/review discovery query is specific enough, and suggest better ones",
      toolSchema: {
        type: "object",
        properties: {
          specific: { type: "boolean", description: "true if the query is specific enough to return good results as-is" },
          coach_message: { type: "string", description: "One short friendly sentence. If specific, a brief confirmation; if not, what's missing and to pick below." },
          suggestions: { type: "array", items: { type: "string" }, description: "3-5 concrete, ready-to-run refined queries (empty if already specific). Each must be a full query someone could run." },
          refined_query: { type: "string", description: "The single best refined version of their query (or the original if already good)." },
        },
        required: ["specific", "coach_message"],
      },
      system:
        "You are a search coach for a B2B discovery tool that finds business leads and customer reviews on the open web. " +
        "Judge if the user's query is specific enough to return good results. A good LEADS query names an INDUSTRY/role and ideally a CITY (e.g. 'aesthetic clinics in Warsaw'). A good REVIEWS query names a SPECIFIC business (e.g. 'reviews about Klinika Ambroziak'). " +
        "If the query is vague (missing industry, or just 'leads in <city>'), set specific=false and propose 4-5 concrete ready-to-run queries covering likely industries for that context, plus a refined_query. " +
        "If it's already specific, set specific=true, suggestions=[]. Suggestions must be complete runnable queries, not fragments.",
      prompt: query,
      workspaceId: c.get("workspaceId"),
      model: process.env.AI_FAST_MODEL || undefined, // route this light task to the cheap model if configured
      maxTokens: 300,
    }).catch(() => ({} as Record<string, unknown>));
    const specific = out.specific !== false; // default to letting it run if the coach fails
    return c.json({
      specific,
      coach_message: typeof out.coach_message === "string" ? out.coach_message : "",
      suggestions: Array.isArray(out.suggestions) ? (out.suggestions as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 5) : [],
      refined_query: typeof out.refined_query === "string" ? out.refined_query : query,
    });
  } catch {
    // Never block a search on the coach — degrade to "specific" so the sweep runs.
    return c.json({ specific: true, coach_message: "", suggestions: [], refined_query: query });
  }
});

router.post("/search", zValidator("json", searchSchema), async (c) => {
  const { query, deep } = c.req.valid("json");
  const params = await classifyQuery(c.get("workspaceId"), query, deep);
  inngest.send({ name: "app/social.discovery.trigger", data: params }).catch(() => {});
  try {
    const result = await runSocialDiscovery(params);
    return c.json({ ok: true, classified: params, ...result }, 200);
  } catch (e) {
    console.error("[discovery] search sweep failed:", e instanceof Error ? e.message : e);
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Sweep failed" }, 200);
  }
});

// STREAMING search (SSE) — the browser watches the agent work live: classifying, searching,
// reading each page, finding each lead, deep-harvesting contacts, writing the overview. Events:
//   {type:"progress", stage, message} · {type:"overview", text} · {type:"done", ...result} · {type:"error", error}
router.post("/search/stream", zValidator("json", searchSchema), async (c) => {
  const { query, deep } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  return streamSSE(c, async (stream) => {
    const send = (data: Record<string, unknown>) => stream.writeSSE({ data: JSON.stringify(data) });
    try {
      await send({ type: "progress", stage: "classify", message: "Understanding your search…" });
      const params = await classifyQuery(workspaceId, query, deep);
      const label = params.searchType === "REVIEWS"
        ? `reviews about "${params.targetSubject}"`
        : `leads: ${params.sector ?? query}${params.region ? ` in ${params.region}` : ""}`;
      await send({ type: "progress", stage: "classify", message: `Searching for ${label}` });
      const result = await runSocialDiscovery(params, (ev) => send(ev));
      await send({ type: "done", ok: true, classified: params, ...result });
    } catch (e) {
      await send({ type: "error", error: e instanceof Error ? e.message : "Sweep failed" });
    }
  });
});

// Promote a discovered lead into a real graph record (the "Save as lead" action). Creates a node
// tagged with discovery provenance so it shows in Saved Leads. Only real, passed-in values are
// stored — nothing invented. Returns the new node id so the client can add it to a list next.
const saveSchema = z.object({
  name: z.string().min(1).max(200),
  object_type: z.string().max(40).default("company"),
  source_url: z.string().max(600).optional(),
  discovery_query: z.string().max(300).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  website: z.string().max(300).optional(),
  handle: z.string().max(120).optional(),
  region: z.string().max(160).optional(),
  summary: z.string().max(1000).optional(),
});
router.post("/save", denyViewerWrites, zValidator("json", saveSchema), async (c) => {
  const b = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const website = b.website || undefined;
  let domain: string | undefined;
  try { if (b.source_url) domain = new URL(b.source_url).host.replace(/^www\./, ""); } catch { /* ignore */ }
  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: workspaceId,
    vertical: objectTypeToVertical(b.object_type),
    object_type: b.object_type,
    created_by: c.get("userId"),
    data: {
      name: b.name,
      source: "discovery",
      discovery_query: b.discovery_query,
      source_url: b.source_url,
      email: b.email,
      phone: b.phone,
      website,
      domain,
      handle: b.handle,
      description: b.summary,
      location: b.region,
    },
  }).select("id").single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ id: data.id }, 201);
});

// Bulk "Save all leads" — promote a whole result set into the graph in one insert.
router.post("/save-batch", denyViewerWrites, zValidator("json", z.object({ leads: z.array(saveSchema).min(1).max(200) })), async (c) => {
  const { leads } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const rows = leads.map((b) => {
    let domain: string | undefined;
    try { if (b.source_url) domain = new URL(b.source_url).host.replace(/^www\./, ""); } catch { /* ignore */ }
    return {
      workspace_id: workspaceId,
      vertical: objectTypeToVertical(b.object_type),
      object_type: b.object_type,
      created_by: userId,
      data: { name: b.name, source: "discovery", discovery_query: b.discovery_query, source_url: b.source_url, email: b.email, phone: b.phone, website: b.website || undefined, domain, handle: b.handle, description: b.summary, location: b.region },
    };
  });
  const { data, error } = await supabase.from("nodes").insert(rows).select("id");
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ saved: data?.length ?? 0, ids: (data ?? []).map((r) => r.id) }, 201);
});

// ── Saved-search monitors ("watch this search") — stored as nodes, re-run by the daily cron. ──
router.get("/monitors", async (c) => {
  const { data } = await supabase
    .from("nodes").select("id, data, created_at")
    .eq("workspace_id", c.get("workspaceId")).eq("object_type", "discovery_monitor")
    .order("created_at", { ascending: false });
  return c.json((data ?? []).map((n) => ({ id: n.id, ...(n.data as Record<string, unknown>), created_at: n.created_at })));
});
router.post("/monitors", zValidator("json", z.object({ query: z.string().min(2).max(300) })), async (c) => {
  const { query } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const params = await classifyQuery(workspaceId, query);
  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: workspaceId,
    vertical: "shared",
    object_type: "discovery_monitor",
    created_by: c.get("userId"),
    data: { query, params, enabled: true, last_run_at: null },
  }).select("id").single();
  return error ? c.json({ error: error.message }, 400) : c.json({ id: data.id, query }, 201);
});
router.delete("/monitors/:id", async (c) => {
  const { error } = await supabase.from("nodes").delete()
    .eq("workspace_id", c.get("workspaceId")).eq("object_type", "discovery_monitor").eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
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

// Clear results — a single lead or the whole feed (fresh start between searches).
router.delete("/all", async (c) => {
  const { error } = await supabase.from("discovered_leads").delete().eq("workspace_id", c.get("workspaceId"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});
router.delete("/:id", async (c) => {
  const { error } = await supabase.from("discovered_leads").delete()
    .eq("workspace_id", c.get("workspaceId")).eq("id", c.req.param("id"));
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
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
