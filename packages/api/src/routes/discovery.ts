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
import { placesDiagnostic, placesDetails } from "../lib/places";
import { buildDossier, type AiEnrichment } from "../lib/discovery-dossier";
import { redditDiagnostic } from "../lib/reddit";
import { aiGatewayToolUse } from "../lib/ai-gateway";
import { streamSSE } from "hono/streaming";
import { graphDedupeKey, buildLeadTask, buildLeadDecision } from "../lib/discovery-pipeline";

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
const searchSchema = z.object({ query: z.string().min(2).max(300), deep: z.boolean().optional(), exhaustive: z.boolean().optional() });

async function classifyQuery(workspaceId: string, query: string, deep?: boolean, exhaustive?: boolean): Promise<DiscoveryParams> {
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
    exhaustive,
  };
}

// SEARCH COACH — a fast, cheap pre-flight that judges whether a query is specific enough to run a
// good (expensive) sweep. Vague queries ("leads in warsaw") get a coaching message + clickable
// suggestions instead of wasting a full search. Specific queries pass straight through.
router.post("/coach", zValidator("json", z.object({ query: z.string().min(1).max(300) })), async (c) => {
  const { query } = c.req.valid("json");
  try {
    const icp = await loadIcp(c.get("workspaceId"));
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
        "If it's already specific, set specific=true, suggestions=[]. Suggestions must be complete runnable queries, not fragments." +
        (icp ? ` The user's ideal customer is: "${icp}". Bias suggestions toward that profile.` : ""),
      prompt: query,
      workspaceId: c.get("workspaceId"),
      maxTokens: 300,
    }).catch(() => ({} as Record<string, unknown>));

    // DETERMINISTIC heuristic so vague queries ALWAYS coach, even if the AI call is flaky/nondeterministic.
    // "leads in warsaw", "companies in london", a bare 1-2 words → vague (a generic collective noun + a
    // place, with no industry). "aesthetic clinics in warsaw", "reviews about X" → specific.
    const words = query.trim().split(/\s+/);
    const GENERIC = /^(leads?|companies|company|businesses|business|prospects?|clients?|contacts?|people|someone|customers?|firms?)$/i;
    const placeMatch = query.match(/\b(?:in|near|around|from)\s+(.+)$/i);
    const place = placeMatch && placeMatch[1] ? placeMatch[1].trim() : "";
    const heuristicVague = (GENERIC.test(words[0] ?? "") && words.length <= 4) || words.filter(Boolean).length <= 1;

    const aiSuggestions = Array.isArray(out.suggestions) ? (out.suggestions as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 5) : [];
    const vague = out.specific === false || heuristicVague;
    const fallback = place ? [`restaurants in ${place}`, `law firms in ${place}`, `dentists in ${place}`, `marketing agencies in ${place}`, `real estate agencies in ${place}`] : [];
    return c.json({
      specific: !vague,
      coach_message: (typeof out.coach_message === "string" && out.coach_message) ? out.coach_message
        : (vague ? `“${query}” is a bit broad — pick an industry to get sharper results, or search anyway:` : ""),
      suggestions: !vague ? [] : (aiSuggestions.length ? aiSuggestions : fallback),
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
  const { query, deep, exhaustive } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  return streamSSE(c, async (stream) => {
    const send = (data: Record<string, unknown>) => stream.writeSSE({ data: JSON.stringify(data) });
    try {
      await send({ type: "progress", stage: "classify", message: "Understanding your search…" });
      const params = await classifyQuery(workspaceId, query, deep, exhaustive);
      params.icp = await loadIcp(workspaceId); // ideal-customer bias for scoring
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
  owner_id: z.string().max(120).optional(),   // assign a reviewer/owner (defaults to the saver)
  list_id: z.string().uuid().optional(),      // atomically add the new record to a list
});
router.post("/save", denyViewerWrites, zValidator("json", saveSchema), async (c) => {
  const b = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const website = b.website || undefined;
  let domain: string | undefined;
  try { if (b.source_url) domain = new URL(b.source_url).host.replace(/^www\./, ""); } catch { /* ignore */ }

  // Dedupe against the GRAPH: if a node with the same domain/name already exists for this object
  // type, return it instead of creating a duplicate (the golden pipeline never double-saves).
  const key = graphDedupeKey(b.name, website, b.source_url);
  if (key) {
    const { data: existing } = await supabase.from("nodes").select("id, data").eq("workspace_id", workspaceId).eq("object_type", b.object_type).limit(5000);
    const match = (existing ?? []).find((n) => {
      const d = (n.data ?? {}) as Record<string, string | undefined>;
      return graphDedupeKey(d.name, d.website, d.source_url) === key;
    });
    if (match) {
      if (b.list_id) await addToList(workspaceId, b.list_id, match.id as string);
      return c.json({ id: match.id, existed: true, list_added: Boolean(b.list_id) });
    }
  }

  const { data, error } = await supabase.from("nodes").insert({
    workspace_id: workspaceId,
    vertical: objectTypeToVertical(b.object_type),
    object_type: b.object_type,
    created_by: userId,
    data: {
      name: b.name,
      source: "discovery",
      owner_id: b.owner_id || userId,   // real owner (assignee) on the saved record
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
  if (b.list_id) await addToList(workspaceId, b.list_id, data.id as string);
  return c.json({ id: data.id, existed: false, list_added: Boolean(b.list_id) }, 201);
});

/** Add a node to a list (workspace-scoped, idempotent-ish position). Best-effort. */
async function addToList(workspaceId: string, listId: string, nodeId: string): Promise<void> {
  const { data: list } = await supabase.from("lists").select("id").eq("workspace_id", workspaceId).eq("id", listId).maybeSingle();
  if (!list) return;
  const { count } = await supabase.from("list_entries").select("*", { count: "exact", head: true }).eq("list_id", listId);
  await supabase.from("list_entries").upsert({ list_id: listId, node_id: nodeId, position: (count ?? 0) + 1 }).then(() => {}, () => {});
}

// ── Ideal Customer Profile (ICP) — one saved description of the user's ideal lead. Boosts scoring
//    (leads matching the ICP rank higher) and tailors the coach's suggestions. Stored on the workspace. ──
router.get("/icp", async (c) => {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", c.get("workspaceId")).maybeSingle();
  const icp = (data?.settings as { discovery_icp?: { description?: string } } | null)?.discovery_icp ?? null;
  return c.json({ description: icp?.description ?? "" });
});
router.post("/icp", denyViewerWrites, zValidator("json", z.object({ description: z.string().max(1000) })), async (c) => {
  const ws = c.get("workspaceId");
  const { data } = await supabase.from("workspaces").select("settings").eq("id", ws).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), discovery_icp: { description: c.req.valid("json").description.trim(), updated_at: new Date().toISOString() } };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", ws);
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true });
});

async function loadIcp(workspaceId: string): Promise<string | undefined> {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const d = (data?.settings as { discovery_icp?: { description?: string } } | null)?.discovery_icp?.description;
  return d && d.trim() ? d.trim() : undefined;
}

// Enrich a lead into a DOSSIER — deep-read its own site (home + /contact + /about + /team), extract
// emails/phones (regex, verbatim), people + summary + category + location (grounded AI), fold in
// Google Places (rating/category/location) and any existing Graph match. Every field carries a real
// SOURCE CITATION; missing fields are reported honestly. Nothing is fabricated. Fail-soft.
router.post("/enrich", denyViewerWrites, zValidator("json", z.object({
  url: z.string().max(600), name: z.string().max(200).optional(), region: z.string().max(160).optional(), object_type: z.string().max(40).optional(),
})), async (c) => {
  const { url, name, region } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const { sovereignScrape } = await import("../lib/sovereign-search");
  let origin = url;
  try { origin = new URL(url.startsWith("http") ? url : `https://${url}`).origin; } catch { return c.json({ error: "Invalid URL" }, 400); }
  const domain = (() => { try { return new URL(origin).host.replace(/^www\./, ""); } catch { return null; } })();

  const pageUrls = [origin, `${origin}/contact`, `${origin}/about`, `${origin}/team`];
  const texts = await Promise.all(pageUrls.map((u) => sovereignScrape(u).catch(() => "")));
  const pages = pageUrls.map((u, i) => ({ url: u, text: texts[i] ?? "" })).filter((p) => p.text);
  const combined = pages.map((p) => p.text).join("\n").slice(0, 14000);

  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const PHONE_RE = /(?:\+|00)[\d][\d\s().-]{7,18}\d/g;
  const emails = [...new Set(combined.match(EMAIL_RE) ?? [])].filter((e) => !/\.(png|jpg|jpeg|svg|webp|gif)$/i.test(e)).slice(0, 6);
  const phones = [...new Set(combined.match(PHONE_RE) ?? [])].slice(0, 4);

  // AI extraction — people, summary, category, location (grounded, never invented).
  let ai: AiEnrichment = {};
  if (combined.trim().length > 120) {
    try {
      const out = await aiGatewayToolUse({
        toolName: "enrich_business",
        toolDescription: "Extract decision-makers, a one-line description, category and location from a business site",
        toolSchema: {
          type: "object",
          properties: {
            people: { type: "array", items: { type: "object", properties: { name: { type: "string" }, role: { type: "string" }, email: { type: "string" } }, required: ["name"] }, description: "Named staff/owners/decision-makers shown on the site (verbatim). Empty if none." },
            company: { type: "string", description: "One-sentence factual description of what the business does, from the site." },
            category: { type: "string", description: "The business's industry/category IF stated on the site (e.g. 'dental clinic', 'law firm'). Empty if not stated." },
            location: { type: "string", description: "City/region/address IF shown on the site. Empty if not shown." },
          },
        },
        system: `Extract ONLY real, verbatim details from this business website${name ? ` for "${name}"` : ""}. Never invent names, emails, category, or location. Leave a field empty if it is not present on the page.`,
        prompt: combined,
        workspaceId, feature: "discovery", maxTokens: 800,
      });
      const o = out as AiEnrichment;
      ai = {
        people: Array.isArray(o.people) ? o.people.filter((p) => p && typeof p.name === "string").slice(0, 10) : [],
        company: typeof o.company === "string" && o.company.trim() ? o.company : null,
        category: typeof o.category === "string" && o.category.trim() ? o.category : null,
        location: typeof o.location === "string" && o.location.trim() ? o.location : null,
      };
    } catch { /* keep regex results even if AI extraction fails */ }
  }

  // Google Places fold-in — real rating/category/location (only when configured + a match exists).
  const places = name ? await placesDetails(name, region).catch(() => null) : null;

  // Existing Graph match — dedupe against the workspace's records by domain/name.
  let graphMatch: { node_id: string; name: string } | null = null;
  const key = graphDedupeKey(name ?? domain, undefined, url);
  if (key) {
    const { data: nodes } = await supabase.from("nodes").select("id, data").eq("workspace_id", workspaceId).limit(5000);
    const m = (nodes ?? []).find((n) => { const d = (n.data ?? {}) as Record<string, string | undefined>; return graphDedupeKey(d.name, d.website, d.source_url) === key; });
    if (m) graphMatch = { node_id: m.id as string, name: (((m.data ?? {}) as Record<string, string>).name) || (name ?? "record") };
  }

  const dossier = buildDossier({ name: name ?? domain ?? "Lead", domain, pages, emails, phones, ai, places, graphMatch });
  // `dossier` is the cited v2 shape; the flat fields keep the pre-drawer UI working unchanged.
  return c.json({ dossier, emails, phones, people: ai.people ?? [], company: ai.company ?? null, scanned: pages.length });
});

// Draft a personalized first-touch outreach message, grounded ONLY in the real signal (their
// situation / what they do / their intent post) — never fabricated. The Discovery → action step.
router.post("/outreach", denyViewerWrites, zValidator("json", z.object({
  name: z.string().max(200),
  context: z.string().max(1500).optional(),
  sector: z.string().max(160).optional(),
  kind: z.enum(["lead", "review"]).default("lead"),
})), async (c) => {
  const b = c.req.valid("json");
  try {
    const out = await aiGatewayToolUse({
      toolName: "draft_outreach",
      toolDescription: "Write a short, personalized first-touch outreach grounded in the real context",
      toolSchema: { type: "object", properties: { subject: { type: "string", description: "a short email subject line" }, message: { type: "string", description: "3-5 sentence outreach body" } }, required: ["message"] },
      system:
        "Write a SHORT, warm, personalized first-touch outreach message (3–5 sentences) to a prospect, grounded ONLY in the real context provided. " +
        "Reference the specific signal (what they do, their situation, or — for an intent post — the exact thing they're looking for). " +
        "No fabricated facts, no fake stats, no hard sell. End with a light call to action. Use a '[Your name]' sign-off placeholder only. " +
        (b.kind === "review" ? "This person publicly complained about / reviewed a competitor — acknowledge their experience tactfully and offer a better alternative." : ""),
      prompt: `Prospect: ${b.name}.${b.sector ? ` I offer services relevant to: ${b.sector}.` : ""} Real context about them: ${b.context || "(limited — keep it general but relevant)"}. Write the outreach.`,
      workspaceId: c.get("workspaceId"), feature: "discovery", maxTokens: 500,
    });
    return c.json({ subject: typeof out.subject === "string" ? out.subject : null, message: typeof out.message === "string" ? out.message : "" });
  } catch {
    return c.json({ subject: null, message: "" });
  }
});

// Bulk "Save all leads" — promote a whole result set into the graph in one insert. Reports which
// leads were newly created vs already in the graph (with the existing node id), sets an owner on
// each new record, and can drop them all into a list.
router.post("/save-batch", denyViewerWrites, zValidator("json", z.object({
  leads: z.array(saveSchema).min(1).max(200),
  owner_id: z.string().max(120).optional(),
  list_id: z.string().uuid().optional(),
})), async (c) => {
  const { leads, owner_id, list_id } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const domainOf = (website?: string, source_url?: string) => {
    const u = website || source_url || "";
    try { return new URL(u.startsWith("http") ? u : `https://${u}`).host.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
  };

  // Map each existing graph key → its node id, so we can REPORT "already in graph as node X".
  const objectTypes = [...new Set(leads.map((l) => l.object_type))];
  const { data: existingNodes } = await supabase.from("nodes").select("id, data").eq("workspace_id", workspaceId).in("object_type", objectTypes).limit(5000);
  const existingByKey = new Map<string, string>();
  for (const n of existingNodes ?? []) {
    const d = (n.data ?? {}) as Record<string, string | undefined>;
    const k = graphDedupeKey(d.name, d.website, d.source_url);
    if (k && !existingByKey.has(k)) existingByKey.set(k, n.id as string);
  }

  const already_existed: { name: string; node_id: string }[] = [];
  const seen = new Set<string>();
  const toInsert = leads.filter((b) => {
    const k = graphDedupeKey(b.name, b.website, b.source_url);
    if (!k) return false;
    if (existingByKey.has(k)) { already_existed.push({ name: b.name, node_id: existingByKey.get(k)! }); return false; }
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const rows = toInsert.map((b) => ({
    workspace_id: workspaceId,
    vertical: objectTypeToVertical(b.object_type),
    object_type: b.object_type,
    created_by: userId,
    data: { name: b.name, source: "discovery", owner_id: owner_id || userId, discovery_query: b.discovery_query, source_url: b.source_url, email: b.email, phone: b.phone, website: b.website || undefined, domain: domainOf(b.website, b.source_url) || undefined, handle: b.handle, description: b.summary, location: b.region },
  }));

  const skipped = leads.length - rows.length;
  if (rows.length === 0) return c.json({ saved: 0, skipped, ids: [], created: [], already_existed }, 200);
  const { data, error } = await supabase.from("nodes").insert(rows).select("id");
  if (error) return c.json({ error: error.message }, 400);
  const ids = (data ?? []).map((r) => r.id as string);
  const created = ids.map((id, i) => ({ name: toInsert[i]?.name ?? "", node_id: id }));
  // Add BOTH newly-created and already-existing matches to the list, so "add selected to list"
  // covers leads that were already in the graph too.
  if (list_id) for (const id of [...ids, ...already_existed.map((a) => a.node_id)]) await addToList(workspaceId, list_id, id);
  return c.json({ saved: ids.length, skipped, ids, created, already_existed }, 201);
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
  const hasScrapeUrl = Boolean(process.env.SOVEREIGN_SCRAPE_URL);
  const hasKey = Boolean(process.env.SOVEREIGN_SEARCH_KEY);
  const diagnostic =
    !hasSearchUrl ? "SOVEREIGN_SEARCH_URL is NOT present on this API deployment — set it on the API/backend project (the one serving api.mondaily.com, not the frontend) and redeploy."
    : !hasScrapeUrl ? "SOVEREIGN_SCRAPE_URL is NOT set — search works but pages can't be read (no lead/review extraction). Set it on the API project and redeploy."
    : !search.reachable ? `SOVEREIGN_SEARCH_URL is set (to '${searchUrl}') but the appliance isn't reachable from the API — verify the value and that the box is online.`
    : search.code === 401 || !hasKey ? "Appliance is up but rejecting requests (401) — SOVEREIGN_SEARCH_KEY is missing or doesn't match the appliance's token. Set it on the API project and redeploy."
    : !scraper_reachable ? `Search is up but the scraper isn't reachable (scrape ${scrape.code}) — pages can't be read. Verify SOVEREIGN_SCRAPE_URL and that the scraper container is running.`
    : "All systems operational.";

  return c.json({
    status: searxng_reachable && scraper_reachable ? "HEALTHY" : "DEGRADED",
    services: { searxng_reachable, scraper_reachable },
    // Env-configured flags + codes so the exact failure is visible from the client/logs.
    configured: { search_url: Boolean(process.env.SOVEREIGN_SEARCH_URL), scrape_url: Boolean(process.env.SOVEREIGN_SCRAPE_URL), search_key: Boolean(process.env.SOVEREIGN_SEARCH_KEY) },
    codes: { search: search.code, scrape: scrape.code },
    diagnostic,
  });
});

// ── Lead → Task : create a "follow up" task from a discovered lead (workspace-scoped). ──
router.post("/lead-task", denyViewerWrites, zValidator("json", z.object({
  name: z.string().min(1).max(200),
  node_id: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
  assignee_id: z.string().max(120).optional(),
  due_date: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  source_url: z.string().max(600).optional(),
})), async (c) => {
  const b = c.req.valid("json");
  const row = buildLeadTask({ workspaceId: c.get("workspaceId"), userId: c.get("userId"), name: b.name, node_id: b.node_id, title: b.title, assignee_id: b.assignee_id, due_date: b.due_date, priority: b.priority, source_url: b.source_url });
  const { data, error } = await supabase.from("tasks").insert(row).select("id, title").single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

// ── Lead → Decision : queue a discovered lead into the Decision Queue for review (workspace-scoped). ──
router.post("/lead-decision", denyViewerWrites, zValidator("json", z.object({
  name: z.string().min(1).max(200),
  node_id: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(1000).optional(),
  recommended_action: z.string().max(300).optional(),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  source_url: z.string().max(600).optional(),
})), async (c) => {
  const b = c.req.valid("json");
  const row = buildLeadDecision({ workspaceId: c.get("workspaceId"), name: b.name, node_id: b.node_id, title: b.title, summary: b.summary, recommended_action: b.recommended_action, risk_level: b.risk_level, email: b.email, phone: b.phone, source_url: b.source_url });
  const { data, error } = await supabase.from("decision_queue").insert(row).select("id, title").single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

// ── Assign owner : set data.owner_id on a saved graph record (workspace-scoped). Used by the
//    detail drawer to (re)assign a reviewer to an already-saved lead. ──
router.post("/assign-owner", denyViewerWrites, zValidator("json", z.object({
  node_id: z.string().uuid(), owner_id: z.string().max(120).nullable(),
})), async (c) => {
  const workspaceId = c.get("workspaceId");
  const { node_id, owner_id } = c.req.valid("json");
  const { data: node } = await supabase.from("nodes").select("id, data").eq("workspace_id", workspaceId).eq("id", node_id).maybeSingle();
  if (!node) return c.json({ error: "Record not found" }, 404);
  const nextData = { ...((node.data ?? {}) as Record<string, unknown>), owner_id: owner_id ?? null };
  const { error } = await supabase.from("nodes").update({ data: nextData }).eq("workspace_id", workspaceId).eq("id", node_id);
  return error ? c.json({ error: error.message }, 400) : c.json({ ok: true, owner_id });
});

// ── Bulk lead → tasks : create a follow-up task per selected lead, with PER-LEAD status so a
//    partial failure is reported honestly (never a blanket "success"). ──
const bulkLeadSchema = z.object({
  name: z.string().min(1).max(200),
  node_id: z.string().uuid().optional(),
  source_url: z.string().max(600).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  summary: z.string().max(1000).optional(),
});
router.post("/bulk-task", denyViewerWrites, zValidator("json", z.object({
  leads: z.array(bulkLeadSchema).min(1).max(200),
  assignee_id: z.string().max(120).optional(),
})), async (c) => {
  const { leads, assignee_id } = c.req.valid("json");
  const workspaceId = c.get("workspaceId"); const userId = c.get("userId");
  const results = await Promise.all(leads.map(async (b) => {
    const row = buildLeadTask({ workspaceId, userId, name: b.name, node_id: b.node_id, assignee_id, source_url: b.source_url });
    const { data, error } = await supabase.from("tasks").insert(row).select("id").single();
    return error ? { name: b.name, ok: false, error: error.message } : { name: b.name, ok: true, id: data.id as string };
  }));
  return c.json({ created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});

// ── Bulk lead → decisions : queue each selected lead into the Decision Queue, per-lead status. ──
router.post("/bulk-decision", denyViewerWrites, zValidator("json", z.object({
  leads: z.array(bulkLeadSchema).min(1).max(200),
})), async (c) => {
  const { leads } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const results = await Promise.all(leads.map(async (b) => {
    const row = buildLeadDecision({ workspaceId, name: b.name, node_id: b.node_id, summary: b.summary, email: b.email, phone: b.phone, source_url: b.source_url });
    const { data, error } = await supabase.from("decision_queue").insert(row).select("id").single();
    return error ? { name: b.name, ok: false, error: error.message } : { name: b.name, ok: true, id: data.id as string };
  }));
  return c.json({ created: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});

export { router as discoveryRouter };
