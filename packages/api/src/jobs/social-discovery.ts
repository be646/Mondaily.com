import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { maybeAutoApprove } from "../lib/autonomy";
import { reasonAboutFinding } from "../lib/agent-reasoning";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";
import { sovereignHeaders, sovereignScrape } from "../lib/sovereign-search";
import { cacheGet, cacheSet, cacheKey } from "../lib/discovery-cache";
import { placesSearch, placesProvider, type PlaceLead } from "../lib/places";
import { redditSearch } from "../lib/reddit";
import { createNotification } from "../lib/notify";
import { createHash } from "node:crypto";

// Stable per-review fingerprint — url + author + content snippet. Distinct reviews (different text)
// get different fingerprints and are all kept; a re-scan of the same review updates in place.
const leadFingerprint = (url: string, author: string, content: string) =>
  createHash("md5").update(`${url}|${author}|${(content || "").slice(0, 200)}`).digest("hex");

// ── Sovereign SearXNG search (private metasearch JSON → result rows) ──────────
interface SearchHit { title: string; content: string; url: string }

export const SEARCH_TIMEOUT_REASON = "Self-hosted search engine instance was temporarily unreachable.";
export const SEARCH_NOT_CONFIGURED_REASON = "Search appliance not configured — SOVEREIGN_SEARCH_URL is not set on the API.";
// Dev-only localhost default; in production an unset env means "not configured" (fail loud), not a
// silent localhost that can't exist on Vercel.
const SOVEREIGN_SEARCH_URL = process.env.SOVEREIGN_SEARCH_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:8080/search" : "");
// Pin to the engines that actually respond from a datacenter IP. Google/DDG/Brave/Startpage
// CAPTCHA-block the box and Bing serves junk — leaving them in the default mix drags the WHOLE
// result to 0 even when Qwant has 10. Overridable via env as more reliable engines are found.
const SOVEREIGN_SEARCH_ENGINES = process.env.SOVEREIGN_SEARCH_ENGINES || "qwant,yahoo";

type SearchResult = { hits: SearchHit[]; unreachable: boolean; rateLimited?: boolean };

async function searxng(query: string): Promise<SearchResult> {
  // Cache hit → skip the (rate-limited) engine entirely. 24h TTL.
  const ck = cacheKey("search", `${SOVEREIGN_SEARCH_ENGINES}:${query}`);
  const cached = await cacheGet<SearchHit[]>(ck);
  if (cached) return { hits: cached, unreachable: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000); // never let one slow query hang the whole sweep
  try {
    // language=en-US pins the locale (the box's German IP otherwise geo-localizes results); engines
    // pinned to the datacenter-reliable set so CAPTCHA'd engines can't zero out the response.
    const url = `${SOVEREIGN_SEARCH_URL}?q=${encodeURIComponent(query)}&format=json&language=en-US&engines=${encodeURIComponent(SOVEREIGN_SEARCH_ENGINES)}`;
    let res = await fetch(url, { headers: { Accept: "application/json", ...sovereignHeaders() }, signal: ctrl.signal });
    if (res.status === 429) {
      // SearXNG's own bot limiter. ONE polite retry after a beat — a burst of 8 query angles can
      // trip it even when the box is perfectly healthy, which is exactly why /discovery/status
      // (a single request) said HEALTHY while sweeps "randomly" returned nothing.
      await new Promise((r) => setTimeout(r, 2_500));
      res = await fetch(url, { headers: { Accept: "application/json", ...sovereignHeaders() }, signal: ctrl.signal });
    }
    if (!res.ok) {
      console.error(`[social-discovery] searxng HTTP ${res.status}`);
      // 429 previously fell into `unreachable: false` with zero hits — i.e. it was reported as
      // "no search results". Eight rate-limited queries produced a clean-looking empty sweep,
      // indistinguishable from a genuinely dry query. A refusal is INFRA, not an answer.
      return { hits: [], unreachable: res.status >= 500 || res.status === 429, rateLimited: res.status === 429 };
    }
    // Same structural keys SearXNG returns under data.results.
    const data = (await res.json()) as { results?: { title?: string; content?: string; url?: string }[] };
    const hits = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? "", content: r.content ?? "", url: r.url as string }));
    if (hits.length) void cacheSet(ck, "search", hits, 86_400); // cache real results for 24h
    return { hits, unreachable: false };
  } catch (e) {
    // Connection drop / DNS / abort (timeout) reaching the self-hosted instance.
    console.error("[social-discovery] searxng unreachable:", e instanceof Error ? e.message : String(e));
    return { hits: [], unreachable: false }; // don't hard-abort the sweep on one slow/aborted query
  } finally {
    clearTimeout(timer);
  }
}

// Wide-net query set per search type. Casting a broad net across the open web (general queries,
// directories, review sites, forums, AND every major social network via site: operators — the
// engines index social pages even when the platforms block direct crawling) massively
// out-performs a couple of narrow queries. We over-generate; dedupe + per-page extraction
// downstream trim the noise.
function buildQueries(searchType: "INTENT_LEADS" | "REVIEWS", sector?: string, region?: string, targetSubject?: string): string[] {
  const loc = region ? ` ${region}` : "";
  if (searchType === "REVIEWS") {
    const subj = (targetSubject ?? sector ?? "").trim();
    // Reviews live under different words per country (opinie/avis/bewertungen/reseñas) and on
    // local review sites, not just English "reviews"/Trustpilot — so we cast a multilingual net.
    return [
      `${subj} reviews${loc}`,
      `${subj} opinie OR avis OR bewertungen OR reseñas OR recensioni${loc}`,
      `"${subj}" complaints OR scam OR "bad experience" OR skarga`,
      `${subj} trustpilot OR "google reviews" OR yelp OR znanylekarz OR gowork OR opineo${loc}`,
      `${subj} customer feedback OR testimonials OR opinie klientów${loc}`,
      `site:reddit.com ${subj}`,
      `site:trustpilot.com ${subj}`,
      `site:facebook.com ${subj} reviews OR opinie`,
    ].filter(q => q.replace(/["']/g, "").trim().length > 6);
  }
  // INTENT_LEADS = find real businesses in a sector/region AND people actively asking to buy.
  const s = (sector ?? "").trim();
  const one = s.replace(/(\w)s\b/, "$1"); // rough singular: "lawyers" → "lawyer" for intent phrasing
  return [
    // Business/provider discovery
    `best ${s}${loc}`,
    `${s}${loc} contact email OR phone`,
    `${s}${loc} directory OR "list of"`,
    `site:linkedin.com ${s}${loc}`,
    // BUYER-INTENT signals — people publicly asking for exactly this ("looking for a lawyer in Warsaw")
    `site:reddit.com ("looking for" OR "recommend" OR "anyone know a good") ${one}${loc}`,
    `"looking for a ${one}"${loc} OR "need a ${one}"${loc}`,
    `"can anyone recommend a ${one}"${loc} OR "recommendations for a ${one}"${loc}`,
    `(site:x.com OR site:twitter.com OR site:quora.com) "looking for" ${one}${loc}`,
  ].filter(q => q.replace(/["']/g, "").trim().length > 4);
}

// Normalize a review sentiment to one of four labels. The model provides it for reviews; if it's
// missing we derive an honest value from the intent (a COMPLAINT is negative), else "neutral".
function normalizeSentiment(
  s: string | undefined,
  intent: "BUY_SIGNAL" | "REVIEW" | "COMPLAINT" | undefined,
): "positive" | "negative" | "neutral" | "mixed" | null {
  const v = (s || "").toLowerCase();
  if (v === "positive" || v === "negative" || v === "neutral" || v === "mixed") return v;
  if (intent === "COMPLAINT") return "negative";
  if (intent === "REVIEW") return "neutral";
  return null;
}

// Human-readable platform from a URL's host — real attribution, not model guesswork.
function platformOf(url: string): string {
  try {
    const host = new URL(url).host.replace(/^www\./, "").toLowerCase();
    if (host.includes("linkedin.")) return "LinkedIn";
    if (host.includes("x.com") || host.includes("twitter.")) return "X";
    if (host.includes("facebook.")) return "Facebook";
    if (host.includes("instagram.")) return "Instagram";
    if (host.includes("reddit.")) return "Reddit";
    if (host.includes("youtube.")) return "YouTube";
    if (host.includes("trustpilot.")) return "Trustpilot";
    if (host.includes("glassdoor.")) return "Glassdoor";
    if (host.includes("tiktok.")) return "TikTok";
    return host;
  } catch { return "web"; }
}

interface ExtractedLead {
  source_url?: string;
  platform?: string;
  author_name?: string;
  raw_content?: string;
  intent_type?: "BUY_SIGNAL" | "REVIEW" | "COMPLAINT";
  sentiment?: "positive" | "negative" | "neutral" | "mixed";
  target_subject?: string;
  region?: string;
  confidence_score?: number;
  // Contact details, extracted ONLY when present verbatim in the source (never invented).
  contact_email?: string;
  contact_phone?: string;
  handle?: string;
  summary?: string;
}

export type DiscoveryParams = { workspaceId: string; region?: string; sector?: string; searchType: "INTENT_LEADS" | "REVIEWS"; targetSubject?: string; deep?: boolean; exhaustive?: boolean; icp?: string };

/** Live progress callback — the streaming endpoint forwards these to the browser as SSE events so
 *  the user watches the agent work (searching → reading pages → finding leads) instead of a spinner. */
export type DiscoveryProgress = (ev: Record<string, unknown>) => void | Promise<void>;

// Core sweep — callable directly (from POST /discovery/run, so results don't depend on Inngest
// actually processing the event in prod) AND wrapped by the Inngest worker below for background runs.
export async function runSocialDiscovery(data: DiscoveryParams, onProgress?: DiscoveryProgress): Promise<Record<string, unknown>> {
    const { workspaceId, region, sector, searchType, targetSubject, deep, exhaustive, icp } = data;
    const icpKeywords = (icp ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 20);
    const emit = async (ev: Record<string, unknown>) => { try { await onProgress?.(ev); } catch { /* progress is best-effort */ } };

    // 1) Web sweep across the query operators (private SearXNG index). STAGGERED in small batches —
    //    firing 10+ queries at bing/qwant simultaneously from one IP trips their rate limits, which
    //    SearXNG then reports as "Suspended: too many requests" and every later query returns 0.
    //    Verified live: rapid-fire parallel queries suspended qwant + wikipedia within seconds.
    // FAIL LOUD if the sovereign search appliance isn't configured — never pretend to search.
    if (!SOVEREIGN_SEARCH_URL) {
      console.error("[social-discovery] " + SEARCH_NOT_CONFIGURED_REASON);
      await emit({ type: "error", error: SEARCH_NOT_CONFIGURED_REASON });
      return { status: "SKIPPED_NOT_CONFIGURED" as const, reason: SEARCH_NOT_CONFIGURED_REASON };
    }
    const queries = buildQueries(searchType, sector, region, targetSubject);
    await emit({ type: "progress", stage: "search", message: `Searching the web across ${queries.length} query angles…` });
    const sweep: SearchResult[] = [];
    for (let i = 0; i < queries.length; i += 2) {
      const batch = queries.slice(i, i + 2);
      sweep.push(...await Promise.all(batch.map((q) => searxng(q))));
      if (i + 2 < queries.length) await new Promise((r) => setTimeout(r, 1200));
    }
    // Short-circuit on a connection drop / infra timeout rather than proceeding
    // with an empty payload.
    if (sweep.some((s) => s.unreachable)) {
      const rateLimited = sweep.some((s) => s.rateLimited);
      const reason = rateLimited
        ? "The search engine rate-limited this sweep — wait a minute and try again."
        : SEARCH_TIMEOUT_REASON;
      console.error("[social-discovery] " + reason);
      return { status: "SKIPPED_INFRASTRUCTURE_TIMEOUT" as const, reason };
    }
    const hits = sweep.flatMap((s) => s.hits);
    if (hits.length === 0) return { discovered: 0, reason: "no search results", diag: { queries: queries.length, hits: 0, unique: 0, extracted: 0, matched: 0 } };
    await emit({ type: "progress", stage: "search", message: `Found ${hits.length} candidate pages — reading the most promising…` });

    const isReviews = searchType === "REVIEWS";
    // TIERED review ranking — the 8 scrape slots must go to pages that actually LIST reviews.
    //   Tier 0: dedicated review-listing pages (GoWork/opinie, ZnanyLekarz, Trustpilot, RatingCaptain,
    //           Opineo, Nuzle, Yelp, Google Maps, /opinie|/reviews paths).
    //   Tier 1: social (Reddit/Facebook) — some reviews.
    //   Tier 2: everything else, incl. clinic HOMEPAGES (few/no reviews) — these were wrongly tied
    //           with real review sites before and crowded GoWork's 97-review page out of the top 8.
    const REVIEW_LISTING = /(gowork|znanylekarz|trustpilot|ratingcaptain|opineo|nuzle|yelp|glassdoor|tripadvisor|\/opinie|\/reviews|\brecenzje\b|google\.[a-z.]+\/maps|g\.page)/i;
    const SOCIAL_HOSTS = /(reddit|facebook|instagram|twitter|x\.com|youtube|tiktok)/i;
    const seen = new Set<string>();
    const uniqueAll = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
    const ranked = [...uniqueAll].sort((a, b) => {
      const rank = isReviews
        ? (u: string) => (REVIEW_LISTING.test(u) ? 0 : SOCIAL_HOSTS.test(u) ? 1 : 2)
        : (u: string) => (platformOf(u) === "web" || platformOf(u).includes(".") ? 1 : 0); // people/social first
      return rank(a.url) - rank(b.url);
    });
    // Reviews deep-scroll each page (rich — 1 page can yield ~90 reviews). With the 300s function
    // budget (Vercel Pro) we can afford many review pages; the tiered ranking keeps them relevant.
    const unique = ranked.slice(0, isReviews ? 20 : 40);

    // 2) Scrape the top pages to full text, then run ONE FOCUSED extraction call PER PAGE, in
    //    parallel batches. This replaces the old single-blob call (36 concatenated pages in one
    //    prompt), which overwhelmed the model into returning 1-2 results — and because WE bind each
    //    extraction to its page's URL, the model never writes a source_url at all: hallucinated or
    //    mismatched URLs are structurally impossible, so nothing gets dropped by URL-matching.
    const SCRAPE_TOP = isReviews ? 14 : 18;
    const toScrape = unique.slice(0, SCRAPE_TOP);
    await emit({ type: "progress", stage: "scrape", message: `Reading ${toScrape.length} pages in full…` });
    // Scroll each page so lazy-loaded review lists fully render (1 review → all reviews). ALWAYS
    // on for reviews (getting them all is the point), and for deep lead runs too.
    const deepScrape = searchType === "REVIEWS" || !!deep;
    const scraped = await Promise.all(toScrape.map((h) => sovereignScrape(h.url, { deep: deepScrape }).catch(() => "")));
    const pageTextCap = deepScrape ? 36_000 : 6_000; // feeds up to 3 multi-pass extraction chunks
    const allPages = unique.map((h, i) => ({
      url: h.url,
      title: h.title,
      text: (i < SCRAPE_TOP && scraped[i] ? scraped[i]! : h.content).slice(0, pageTextCap),
    })).filter((p) => p.text.trim().length > 60); // nothing meaningful to extract from

    // PRE-FILTER (token saver): only spend an AI extraction call on a page that plausibly contains
    // what we're after. Pages with zero on-topic signal are skipped — they had nothing anyway, so
    // this cuts AI calls with no quality loss. Fall back to all pages if the filter is too strict.
    const subjectTokens = `${sector ?? ""} ${targetSubject ?? ""}`.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const REVIEW_SIGNAL = /(review|opinion|opini|rating|star|gwiazd|testimonial|recommend|polec|complaint|skarga|verified|customer|avis|bewert|reseñ|recension)/i;
    const LEAD_SIGNAL = /(@|e-?mail|contact|kontakt|phone|tel[:.]|call|linkedin|company|founder|ceo|director|manager|owner|clinic|klinik|office)/i;
    const hasSignal = (text: string) => {
      const t = text.toLowerCase();
      if (subjectTokens.some((w) => t.includes(w))) return true;
      return (searchType === "REVIEWS" ? REVIEW_SIGNAL : LEAD_SIGNAL).test(text);
    };
    const signalPages = allPages.filter((p) => hasSignal(p.text));
    const pages = signalPages.length >= Math.min(4, allPages.length) ? signalPages : allPages;
    const skipped = allPages.length - pages.length;

    // Per-search usage meter — accumulate real provider tokens across every AI call this run so the
    // UI can show cost and it's recorded to ai_usage/credits (Discovery was previously un-metered).
    let usedTokens = 0, aiCalls = 0;
    const meter = (u: { total_tokens: number }) => { usedTokens += u.total_tokens; aiCalls++; };

    await emit({ type: "progress", stage: "extract", message: `Analyzing ${pages.length} pages with the agent${skipped > 0 ? ` (skipped ${skipped} with no signal)` : ""}…` });

    const wantReviews = searchType === "REVIEWS";
    const perPageSchema: GatewayToolRequest["toolSchema"] = {
      type: "object",
      properties: {
        leads: {
          type: "array",
          description: "Every genuine, on-topic result found ON THIS PAGE. Empty array if the page has none.",
          items: {
            type: "object",
            properties: {
              author_name: { type: "string", description: "The person's or business's name if identifiable on the page" },
              raw_content: { type: "string", description: wantReviews ? "The review/opinion text, verbatim (the WHOLE review, not a fragment)" : "The relevant quote/snippet, verbatim" },
              intent_type: { type: "string", description: "BUY_SIGNAL | REVIEW | COMPLAINT" },
              sentiment: { type: "string", description: wantReviews ? "positive | negative | neutral | mixed — the reviewer's overall sentiment toward the subject, judged ONLY from the review text" : "Omit for non-review results" },
              target_subject: { type: "string", description: "The person/company being reviewed, if any" },
              region: { type: "string" },
              confidence_score: { type: "number", description: "0-100 how clearly this matches the search intent" },
              contact_email: { type: "string", description: "Email ONLY if it appears verbatim on the page — else omit" },
              contact_phone: { type: "string", description: "Phone ONLY if it appears verbatim on the page — else omit" },
              handle: { type: "string", description: "Social handle/username if present (e.g. @name)" },
              summary: { type: "string", description: "One sentence: who this is and why they're relevant" },
            },
            required: ["intent_type"],
          },
        },
      },
    };
    const ask = wantReviews
      ? `Extract EVERY review, opinion, testimonial, or complaint${targetSubject ? ` about "${targetSubject}"` : ""} from this page — the full review text verbatim, with the reviewer's name when shown.`
      : `Extract EVERY real person or business on this page that fits: sector "${sector ?? ""}"${region ? `, region "${region}"` : ""} — prospects, providers, or people showing interest. Include name + any email/phone/handle that appears verbatim.`;

    let gatewayFailures = 0;
    let lastGatewayError: string | null = null;
    // One extraction call over a single text block.
    const extractChunk = async (p: { url: string; title: string }, text: string): Promise<(ExtractedLead & { source_url: string })[]> => {
      try {
        const out = await aiGatewayToolUse({
          toolName: "extract_from_page",
          toolDescription: "Extract real leads/reviews from one web page",
          toolSchema: perPageSchema,
          workspaceId, feature: "discovery",  // meter to ai_usage / credit wallet
          onUsage: meter,       // + accumulate for this search's cost display
          maxTokens: wantReviews ? 6000 : 1600,
          system:
            `You extract REAL ${wantReviews ? "reviews and opinions" : "leads and prospects"} from a single web page. ` +
            `ABSOLUTE RULES: only report what is literally on the page — never invent names, emails, phones, or review text. ` +
            `Contact details ONLY when they appear verbatim. ${region ? `Region "${region}" is a preference, not a hard filter — keep unclear-region results at lower confidence.` : ""} ` +
            `Return an empty array if the page genuinely has nothing on-topic. Do not pad.`,
          prompt: `${ask}\n\nPAGE TITLE: ${p.title}\nPAGE URL: ${p.url}\n\nPAGE CONTENT:\n${text}`,
        });
        const leads = Array.isArray((out as { leads?: unknown }).leads) ? (out as { leads: ExtractedLead[] }).leads : [];
        return leads.filter((l) => l.intent_type).map((l) => ({ ...l, source_url: p.url }));
      } catch (err: any) {
        gatewayFailures++;
        lastGatewayError = (err?.message ?? String(err)).slice(0, 200);
        return [];
      }
    };
    // MULTI-PASS: a big review page holds more reviews than one call can output — split it into
    // ~12k chunks and extract each, so a 97-review page returns most/all of them (300s budget).
    const extractPage = async (p: { url: string; title: string; text: string }): Promise<(ExtractedLead & { source_url: string })[]> => {
      if (wantReviews && p.text.length > 13_000) {
        const CHUNK = 12_000;
        const chunks: string[] = [];
        for (let s = 0; s < p.text.length; s += CHUNK) chunks.push(p.text.slice(s, s + CHUNK));
        const passes = await Promise.all(chunks.slice(0, 3).map((c) => extractChunk(p, c)));
        return passes.flat();
      }
      return extractChunk(p, p.text);
    };

    // Lead priority (Phase 1 scoring) — a fast, deterministic fit+reachability signal, no AI cost:
    // confidence + a big bonus for having a real contact + a bonus for being an actual business site
    // (vs a social page). Lets the pipeline rank hot → cold instead of showing a flat list.
    const SOCIAL_HOST = /linkedin|reddit|facebook|instagram|(^|\.)x\b|twitter|youtube|tiktok/i;
    const icpMatch = (text: string) => icpKeywords.length > 0 && icpKeywords.some((k) => text.toLowerCase().includes(k));
    const priorityOf = (conf: number, hasContact: boolean, platform: string, matchesIcp = false): "hot" | "warm" | "cold" => {
      const business = !SOCIAL_HOST.test(platform);
      const s = conf + (hasContact ? 25 : 0) + (business ? 10 : 0) + (matchesIcp ? 20 : 0); // ICP fit boost
      return s >= 85 ? "hot" : s >= 55 ? "warm" : "cold";
    };

    // Map an extracted lead to the compact display row the chat UI renders.
    const toDisplay = (l: ExtractedLead & { source_url: string }) => {
      const platform = platformOf(l.source_url);
      const confidence_score = typeof l.confidence_score === "number" ? Math.round(l.confidence_score) : 0;
      return {
        source_url: l.source_url,
        platform,
        author_name: l.author_name || "Anonymous",
        intent_type: l.intent_type,
        sentiment: normalizeSentiment(l.sentiment, l.intent_type),
        confidence_score,
        priority: priorityOf(confidence_score, !!(l.contact_email || l.contact_phone), platform, icpMatch(`${l.author_name ?? ""} ${l.summary ?? ""} ${l.raw_content ?? ""}`)),
        region: l.region ?? region ?? null,
        target_subject: l.target_subject ?? targetSubject ?? null,
        snippet: (l.summary || l.raw_content || "").slice(0, 400),
        email: l.contact_email ?? null,
        phone: l.contact_phone ?? null,
        handle: l.handle ?? null,
      };
    };

    // Parallel in batches of 6 — fast without slamming the AI provider all at once. After EACH batch
    // we stream the results-so-far, so a run cut short by the 60s limit still delivers what it found.
    const allLeads: (ExtractedLead & { source_url: string })[] = [];
    for (let i = 0; i < pages.length; i += 6) {
      const batch = pages.slice(i, i + 6);
      const results = await Promise.all(batch.map(extractPage));
      for (let j = 0; j < results.length; j++) {
        const found = results[j]!;
        allLeads.push(...found);
        if (found.length > 0) {
          await emit({ type: "progress", stage: "extract", message: `${platformOf(batch[j]!.url)} — found ${found.length} result${found.length === 1 ? "" : "s"} (${found.map((f) => f.author_name).filter(Boolean).slice(0, 3).join(", ") || "unnamed"})` });
        }
      }
      if (allLeads.length) {
        // De-dupe by URL+author+snippet for a clean progressive view.
        const seenK = new Set<string>();
        const partial = allLeads.map(toDisplay).filter((r) => { const k = `${r.source_url}|${r.author_name}|${r.snippet.slice(0, 40)}`; return seenK.has(k) ? false : (seenK.add(k), true); }).slice(0, 120);
        await emit({ type: "results", kind: searchType, discovered: partial.length, scanned: unique.length, results: partial });
      }
    }

    // ── CONNECTORS (leads only): structured local businesses (Places) + buyer-intent (Reddit) ──
    // Both fail-open; they ADD to the web-extracted leads, they never replace or block them.
    if (searchType === "INTENT_LEADS" && sector) {
      // Places: real local businesses with name/phone/website (Google if keyed, else OSM).
      // EXHAUSTIVE city sweep: Places/Maps caps ~60 per area, so we loop the city's districts and
      // merge — the way to get "every clinic in Warsaw" (100s) instead of one 60-result page.
      await emit({ type: "progress", stage: "places", message: `Looking up local businesses via ${placesProvider() === "google" ? "Google Places" : "OpenStreetMap"}…` });
      const places: PlaceLead[] = await placesSearch(sector, region, 60).catch(() => []);
      if (exhaustive && region) {
        await emit({ type: "progress", stage: "places", message: `Exhaustive sweep — finding ${region}'s districts…` });
        let districts: string[] = [];
        try {
          const d = await aiGatewayToolUse({
            toolName: "list_districts",
            toolDescription: "List the main districts/neighborhoods of a city",
            toolSchema: { type: "object", properties: { districts: { type: "array", items: { type: "string" }, description: "up to 12 main districts/boroughs of the city" } }, required: ["districts"] },
            system: "List the main administrative districts or well-known neighborhoods of the given city, for looping a local-business search. Return names only, no country.",
            prompt: region,
            workspaceId, feature: "discovery", onUsage: meter, maxTokens: 300,
          });
          districts = Array.isArray((d as { districts?: unknown }).districts) ? (d as { districts: string[] }).districts.filter((x) => typeof x === "string").slice(0, 12) : [];
        } catch { /* fall back to the single-area result */ }
        for (const district of districts) {
          const more = await placesSearch(sector, `${district}, ${region}`, 60).catch(() => []);
          if (more.length) { places.push(...more); await emit({ type: "progress", stage: "places", message: `${district}: +${more.length} businesses` }); }
        }
        // De-dup by name+address across districts.
        const seenP = new Set<string>();
        const unique = places.filter((p) => { const k = `${p.name}|${p.address ?? ""}`.toLowerCase(); return seenP.has(k) ? false : (seenP.add(k), true); });
        places.length = 0; places.push(...unique);
      }
      for (const pl of places) {
        allLeads.push({
          author_name: pl.name,
          raw_content: pl.address ?? "",
          intent_type: "BUY_SIGNAL",
          target_subject: sector,
          region: region,
          confidence_score: 88,
          contact_email: undefined,
          contact_phone: pl.phone ?? undefined,
          handle: undefined,
          summary: `${pl.source === "google" ? "Google Maps" : "OpenStreetMap"} business${pl.address ? ` · ${pl.address.slice(0, 80)}` : ""}`,
          source_url: pl.website || pl.source_url,
        });
      }
      if (places.length) await emit({ type: "progress", stage: "places", message: `Found ${places.length} businesses with contact details` });

      // Reddit: fresh public buyer-intent posts ("looking for a <sector> in <region>").
      const one = sector.replace(/(\w)s\b/, "$1");
      const intentQ = `${region ? region + " " : ""}${one} (looking for OR recommend OR "anyone know")`;
      const redditHits = await redditSearch(intentQ, 25).catch(() => []);
      const INTENT_RE = /(looking for|recommend|anyone know|need a|suggestions|szukam|polec|help me find|where can i)/i;
      const fresh = redditHits.filter((h) => INTENT_RE.test(`${h.title} ${h.text}`)).slice(0, 15);
      for (const rp of fresh) {
        allLeads.push({
          author_name: rp.author ? `u/${rp.author}` : (rp.subreddit ?? "Reddit user"),
          raw_content: `${rp.title}${rp.text ? " — " + rp.text : ""}`.slice(0, 500),
          intent_type: "BUY_SIGNAL",
          target_subject: sector,
          region: region,
          confidence_score: 72,
          contact_email: undefined,
          contact_phone: undefined,
          handle: rp.author ? `u/${rp.author}` : undefined,
          summary: `Reddit buyer-intent${rp.subreddit ? ` · ${rp.subreddit}` : ""}: ${rp.title.slice(0, 110)}`,
          source_url: rp.url,
        });
      }
      if (fresh.length) await emit({ type: "progress", stage: "reddit", message: `Found ${fresh.length} buyer-intent posts on Reddit` });
    }

    // DEEP MODE — second-pass contact harvest. Listing/social pages often name a business without
    // its email/phone; the business's OWN site usually has both. For leads still missing contact
    // info, visit their source domain's /contact (and homepage) and pull emails/phones via REGEX
    // from the real page text — regex on scraped text is deterministic real data, zero AI, zero
    // fabrication risk.
    if (deep && searchType !== "REVIEWS") {
      const missing = allLeads.filter((l) => !l.contact_email && !l.contact_phone);
      const domains = [...new Set(missing.map((l) => { try { return new URL(l.source_url).origin; } catch { return ""; } }).filter(Boolean))]
        .filter((o) => !/linkedin|x\.com|twitter|facebook|instagram|reddit|youtube|trustpilot/i.test(o))
        .slice(0, 8);
      if (domains.length) {
        await emit({ type: "progress", stage: "deep", message: `Deep mode — visiting ${domains.length} business sites for contact details…` });
        const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const PHONE_RE = /(?:\+|00)[\d][\d\s().-]{7,18}\d/g;
        for (const origin of domains) {
          const texts = await Promise.all([
            sovereignScrape(`${origin}/contact`).catch(() => ""),
            sovereignScrape(origin).catch(() => ""),
          ]);
          const text = texts.join("\n");
          const emails = [...new Set(text.match(EMAIL_RE) ?? [])].filter((e) => !/\.(png|jpg|svg|webp|gif)$/i.test(e)).slice(0, 3);
          const phones = [...new Set(text.match(PHONE_RE) ?? [])].slice(0, 2);
          if (emails.length || phones.length) {
            for (const l of allLeads) {
              try {
                if (new URL(l.source_url).origin === origin) {
                  if (!l.contact_email && emails[0]) l.contact_email = emails[0];
                  if (!l.contact_phone && phones[0]) l.contact_phone = phones[0];
                }
              } catch { /* skip malformed */ }
            }
            await emit({ type: "progress", stage: "deep", message: `${origin.replace(/^https?:\/\/(www\.)?/, "")} — found ${emails.length} email${emails.length === 1 ? "" : "s"}, ${phones.length} phone${phones.length === 1 ? "" : "s"}` });
          }
        }
      }
    }

    const rows = allLeads.map((l) => ({
      workspace_id: workspaceId,
      source_url: l.source_url,
      fingerprint: leadFingerprint(l.source_url, l.author_name || "Anonymous", l.raw_content || ""),
      // NOT NULL columns — always provide a value. Platform is derived from the REAL url host.
      platform: platformOf(l.source_url),
      author_name: l.author_name || "Anonymous",
      raw_content: l.raw_content || "",
      intent_type: l.intent_type!,
      target_subject: l.target_subject ?? targetSubject ?? null,
      region: l.region ?? region ?? null,
      confidence_score: typeof l.confidence_score === "number" ? Math.max(0, Math.min(100, Math.round(l.confidence_score))) : 0,
      // Structured contact block (needs the `contact jsonb` column — 20260701 migration).
      // sentiment lives here too (no schema change): the model's read for reviews, else derived
      // from intent_type (COMPLAINT → negative) so every review row carries a real sentiment.
      contact: {
        email: l.contact_email?.trim() || null,
        phone: l.contact_phone?.trim() || null,
        handle: l.handle?.trim() || null,
        summary: l.summary?.trim() || null,
        sentiment: normalizeSentiment(l.sentiment, l.intent_type),
      },
    }));

    // Diagnostics so a thin result is explainable without prod logs: where did the pipeline drop?
    const gatewayReturned = gatewayFailures < pages.length; // at least one extraction call succeeded
    const diag = {
      queries: queries.length,
      hits: hits.length,
      unique: unique.length,
      scraped: scraped.filter(Boolean).length, // pages rendered to full text (vs snippet-only)
      pages_analyzed: pages.length,            // pages that had enough content to extract from
      gateway: gatewayReturned,                // false → EVERY per-page extraction call failed
      gateway_error: gatewayFailures > 0 ? lastGatewayError : null,
      extracted: allLeads.length,              // leads the per-page extractions returned
      matched: rows.length,                    // same as extracted now — URLs are bound, never dropped
    };
    if (rows.length === 0) {
      const reason = !gatewayReturned ? `extraction failed${lastGatewayError ? `: ${lastGatewayError}` : ""}`
        : "no on-topic results found in the analyzed pages";
      return { discovered: 0, scanned: unique.length, reason, diag };
    }

    // Collapse rows that share a source_url — discovered_leads is UNIQUE on source_url, and Postgres
    // rejects an upsert that hits the same conflict target twice in one statement ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"). The model often returns several leads from
    // one page; keep the highest-confidence one per URL.
    // De-dupe within THIS batch by fingerprint (distinct reviews survive; identical ones collapse).
    const byFp = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const prev = byFp.get(r.fingerprint);
      if (!prev || (r.confidence_score ?? 0) > (prev.confidence_score ?? 0)) byFp.set(r.fingerprint, r);
    }
    const dedupedRows = [...byFp.values()];

    // Compact display rows for the chat UI — ranked hot → cold by priority (Phase 1 scoring).
    const PRIO_RANK = { hot: 0, warm: 1, cold: 2 } as const;
    const results = [...dedupedRows]
      .map((r) => {
        const priority = priorityOf(r.confidence_score ?? 0, !!(r.contact?.email || r.contact?.phone), r.platform, icpMatch(`${r.author_name ?? ""} ${r.contact?.summary ?? ""} ${r.raw_content ?? ""}`));
        return {
          source_url: r.source_url,
          platform: r.platform,
          author_name: r.author_name,
          intent_type: r.intent_type,
          sentiment: r.contact?.sentiment ?? null,
          confidence_score: r.confidence_score ?? 0,
          priority,
          region: r.region,
          target_subject: r.target_subject,
          snippet: (r.contact?.summary || r.raw_content || "").slice(0, 400),
          email: r.contact?.email ?? null,
          phone: r.contact?.phone ?? null,
          handle: r.contact?.handle ?? null,
        };
      })
      .sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || (b.confidence_score ?? 0) - (a.confidence_score ?? 0))
      .slice(0, 120);

    // Stream the results NOW — before the slow DB upsert + AI overview — so the browser renders them
    // even if the tail of the run is cut short by the serverless time limit. This is what fixes
    // "found N results" but the UI showing nothing.
    await emit({ type: "results", kind: searchType, discovered: dedupedRows.length, scanned: unique.length, results });

    // AI OVERVIEW — generated NOW (before the DB upsert) so it always completes and streams, rather
    // than being the last thing to run and the first to be cut off. Grounded in the extracted rows only.
    let overview: string | null = null;
    if (dedupedRows.length >= 2) {
      await emit({ type: "progress", stage: "overview", message: "Writing the AI overview of what was found…" });
      const wantReviewsOverview = searchType === "REVIEWS";
      const sentimentTally = dedupedRows.reduce((a, r) => { const s = (r.contact as { sentiment?: string })?.sentiment; if (s) a[s] = (a[s] ?? 0) + 1; return a; }, {} as Record<string, number>);
      const digest = dedupedRows.slice(0, 30).map((r) =>
        `- [${r.intent_type}${(r.contact as { sentiment?: string })?.sentiment ? `/${(r.contact as { sentiment?: string }).sentiment}` : ""}] ${r.author_name} (${r.platform}${r.region ? `, ${r.region}` : ""}, conf ${r.confidence_score})` +
        `${r.contact.email ? ` email:${r.contact.email}` : ""}${r.contact.phone ? ` phone:yes` : ""}: ${(r.contact.summary || r.raw_content || "").slice(0, 160)}`
      ).join("\n");
      try {
        // Use the STRUCTURED tool path (same one extraction uses reliably) — the plain-completion
        // path can return empty content on a reasoning model, which is why the overview never showed.
        const out = await aiGatewayToolUse({
          toolName: "write_overview",
          toolDescription: "Write one short grounded briefing of the discovery findings",
          toolSchema: { type: "object", properties: { summary: { type: "string", description: "The briefing text, plain prose, no markdown headers." } }, required: ["summary"] },
          workspaceId, feature: "discovery", onUsage: meter,
          maxTokens: 700,
          system: wantReviewsOverview
            ? "You analyze REAL customer reviews for a business user researching a company/competitor. Using ONLY the reviews below, write a short plain briefing: " +
              "1) the sentiment balance (use the given counts), 2) the 2-3 most common COMPLAINTS (pitch angles for a competitor), 3) the main PRAISE, 4) one sentence on the opportunity. " +
              "NEVER invent a complaint, praise, name, or number not supported by the reviews."
            : "You summarize web-discovery results for a business user in 2-4 short sentences describing ONLY what the findings show — counts, platforms, contactability. Never add a fact not in the findings.",
          prompt: `Search: ${wantReviewsOverview ? `reviews about "${targetSubject ?? sector}"` : `leads in "${sector}"`}${region ? ` (${region})` : ""}. ` +
            `${wantReviewsOverview ? `Sentiment counts: ${JSON.stringify(sentimentTally)}. ` : ""}Findings (${dedupedRows.length} total, first 30 shown):\n${digest}`,
        });
        overview = typeof out.summary === "string" ? (out.summary.trim() || null) : null;
        if (overview) await emit({ type: "overview", text: overview });
      } catch { /* overview is a bonus — never fail the sweep for it */ }
    }

    // 3) Upsert on the per-workspace fingerprint so every distinct review is kept. Falls back through
    //    older shapes if a migration hasn't run yet, so discovery keeps working during rollout.
    const upsertLeads = async (batch: typeof dedupedRows) => {
      // Preferred: per-workspace fingerprint (20260702 migration).
      let r = await supabase.from("discovered_leads").upsert(batch, { onConflict: "workspace_id,fingerprint" });
      // Pre-migration: no fingerprint column/index yet → drop it and fall back to source_url dedupe.
      if (r.error && /fingerprint/i.test(r.error.message)) {
        const collapsed = [...new Map(batch.map((x) => [x.source_url, x])).values()].map(({ fingerprint, ...x }) => x);
        r = await supabase.from("discovered_leads").upsert(collapsed, { onConflict: "source_url" });
        // Older still: no contact column.
        if (r.error && /contact/i.test(r.error.message)) {
          r = await supabase.from("discovered_leads").upsert(collapsed.map(({ contact, ...x }) => x), { onConflict: "source_url" });
        }
      } else if (r.error && /contact/i.test(r.error.message)) {
        r = await supabase.from("discovered_leads").upsert(batch.map(({ contact, ...x }) => x), { onConflict: "workspace_id,fingerprint" });
      }
      return r.error;
    };
    let error = await upsertLeads(dedupedRows);
    if (error) {
      console.error("[social-discovery] upsert failed:", error.message);
      return { discovered: 0, scanned: unique.length, error: error.message };
    }

    // 4) Agent-driven: auto-queue the STRONGEST leads (high confidence + a real contact) into the
    //    Decision Queue for one-click bulk approval — same pattern the prospecting agent uses.
    //    Approving one creates a real, agent-marked lead record. Weaker/contactless leads stay in
    //    the Discovery list for manual review (they don't spam the queue).
    let queued = 0;
    if (searchType !== "REVIEWS") {
      // Auto-queue the HOT leads — priority already factors confidence + a real contact + being a
      // real business + ICP fit, so the autonomous loop queues exactly the best-fit, reachable leads.
      const strong = dedupedRows.filter((r) =>
        priorityOf(r.confidence_score ?? 0, !!(r.contact?.email || r.contact?.phone), r.platform,
          icpMatch(`${r.author_name ?? ""} ${r.contact?.summary ?? ""} ${r.raw_content ?? ""}`)) === "hot"
        && (r.contact?.email || r.contact?.phone));
      if (strong.length) {
        // Dedup against already-pending discovery decisions (by source_url in their evidence).
        const { data: pending } = await supabase.from("decision_queue")
          .select("evidence").eq("workspace_id", workspaceId).eq("agent_name", "discovery").eq("status", "pending");
        const seenUrls = new Set((pending ?? []).flatMap((d) => Array.isArray(d.evidence) ? d.evidence.map((e: any) => e?.lead?.source_url) : []));
        // Await the inserts so `queued` is accurate before the notification body reads it.
        // Reason about the top few leads (RAG-grounded WHY this lead matters vs the workspace's
        // existing graph) — capped so a big harvest doesn't blow the reasoning budget; the rest keep
        // the rule-based line. reasonAboutFinding is fail-soft (returns the defaults on any error).
        const fresh = strong.filter((r) => !seenUrls.has(r.source_url));
        let reasonBudget = 5;
        const inserts = fresh.map(async (r) => {
          const defaultAction = `Add "${r.author_name || "this lead"}" as a lead record`;
          const defaultReason = `Confidence ${r.confidence_score ?? 0}${r.contact?.email ? ` · ${r.contact.email}` : ""}`;
          let title = `Add ${r.author_name || "lead"} from Discovery?`;
          let summary = r.contact?.summary || (r.raw_content || "").slice(0, 160) || "Discovered from the web";
          let action = defaultAction;
          let matchReason = defaultReason;
          let confidence: "low" | "medium" | "high" | undefined;
          if (reasonBudget > 0) {
            reasonBudget--;
            const rec = await reasonAboutFinding(workspaceId, {
              agentName: "Prospecting Agent",
              recordName: r.author_name || "Discovered lead",
              facts: `Discovered lead "${r.author_name ?? "unknown"}" from ${r.platform ?? "the web"}${r.target_subject ? ` about "${r.target_subject}"` : ""}${r.region ? ` in ${r.region}` : ""}. Confidence ${r.confidence_score ?? 0}. ${r.contact?.email ? `Email: ${r.contact.email}. ` : ""}${r.contact?.summary || (r.raw_content || "").slice(0, 240)}`,
              defaultTitle: title,
              defaultAction,
              defaultRisk: "low",
            }).catch(() => null);
            if (rec?.reasoned) { title = rec.title; summary = rec.summary || summary; action = rec.recommended_action; matchReason = rec.rationale || defaultReason; confidence = rec.confidence; }
          }
          const { data: sd } = await supabase.from("decision_queue").insert({
            workspace_id: workspaceId,
            source_type: "discovered_lead",
            source_id: null,
            agent_name: "discovery",
            title,
            summary,
            recommended_action: action,
            // MEDIUM — approving this creates a permanent record in the graph. See the rationale on
            // buildLeadDecision in lib/discovery-pipeline.ts; both discovery paths must agree, or
            // whichever one stayed "low" would quietly keep the old auto-creating behaviour.
            risk_level: "medium",
            evidence: [{
              type: "discovered_lead",
              title: r.author_name || "Lead",
              match_reason: matchReason,
              ...(confidence ? { confidence } : {}),
              lead: { name: r.author_name, email: r.contact?.email ?? null, phone: r.contact?.phone ?? null, handle: r.contact?.handle ?? null, summary: r.contact?.summary ?? null, source_url: r.source_url, region: r.region, subject: r.target_subject },
            }],
          }).select("*").single().then((x) => x, () => ({ data: null }));
          if (!sd) return false;
          await maybeAutoApprove(workspaceId, sd);
          return true;
          });
        queued = (await Promise.all(inserts)).filter(Boolean).length;
      }
    }


    // 6) Agent notifies the workspace (best-effort, never blocks).
    if (dedupedRows.length > 0) {
      const what = searchType === "REVIEWS" ? "reviews/mentions" : "leads";
      await createNotification({
        workspace_id: workspaceId,
        type: "agent",
        title: `Discovery Agent found ${dedupedRows.length} ${what}`,
        body: `From ${unique.length} sources${sector ? ` for "${sector}"` : ""}${region ? ` in ${region}` : ""}${targetSubject ? ` about "${targetSubject}"` : ""}.` +
          (queued > 0 ? ` ${queued} strong lead${queued === 1 ? "" : "s"} queued in your Decision Queue for approval.` : " Review them in Discovery."),
        metadata: { count: dedupedRows.length, queued, search_type: searchType },
        source: { source_agent: "prospecting", route: queued > 0 ? "/decisions" : "/discovery" },
      }).catch(() => {});
    }

    // Per-search cost telemetry — real tokens spent + AI calls + pages saved by the pre-filter.
    const usage = { tokens: usedTokens, ai_calls: aiCalls, pages_skipped: skipped };
    await emit({ type: "usage", ...usage });

    return { discovered: dedupedRows.length, scanned: unique.length, queued, overview, kind: searchType, results, usage, diag };
}

/**
 * SAVED-SEARCH MONITORS — "watch this search". Monitors are stored as nodes
 * (object_type "discovery_monitor" — no migration needed) and re-run by the daily cron. The
 * fingerprint-keyed upsert makes dedup automatic: re-running only ADDS genuinely new results, so
 * the count delta = what's new since last run. New finds → agent notification.
 */
export async function runDiscoveryMonitors(): Promise<{ monitors: number; new_results: number }> {
  const { data: monitors } = await supabase
    .from("nodes").select("id, workspace_id, data")
    .eq("object_type", "discovery_monitor");
  let totalNew = 0;
  for (const m of monitors ?? []) {
    const d = (m.data ?? {}) as { query?: string; params?: DiscoveryParams; enabled?: boolean };
    if (d.enabled === false || !d.params) continue;
    const before = await supabase.from("discovered_leads").select("id", { count: "exact", head: true }).eq("workspace_id", m.workspace_id as string);
    const result = await runSocialDiscovery({ ...d.params, workspaceId: m.workspace_id as string }).catch(() => null);
    const after = await supabase.from("discovered_leads").select("id", { count: "exact", head: true }).eq("workspace_id", m.workspace_id as string);
    const fresh = Math.max(0, (after.count ?? 0) - (before.count ?? 0));
    totalNew += fresh;
    await supabase.from("nodes").update({ data: { ...d, last_run_at: new Date().toISOString(), last_new: fresh, last_total: (result as { discovered?: number } | null)?.discovered ?? 0 } }).eq("id", m.id as string);
    if (fresh > 0) {
      await createNotification({
        workspace_id: m.workspace_id as string,
        type: "agent",
        title: `Monitor "${d.query ?? "saved search"}" found ${fresh} new result${fresh === 1 ? "" : "s"}`,
        body: "Your watched Discovery search picked up new results since the last run. Review them in Discovery.",
        metadata: { monitor_id: m.id, new: fresh },
        source: { source_agent: "prospecting", route: "/discovery" },
      }).catch(() => {});
    }
  }
  return { monitors: (monitors ?? []).length, new_results: totalNew };
}

export const socialDiscoveryWorker = inngest.createFunction(
  { id: "social-media-listening-discovery", name: "Social listening & intent discovery", concurrency: { limit: 3 } },
  { event: "app/social.discovery.trigger" },
  async ({ event }) => runSocialDiscovery(event.data),
);
