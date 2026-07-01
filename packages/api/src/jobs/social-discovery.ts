import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";
import { sovereignHeaders, sovereignScrape } from "../lib/sovereign-search";
import { createNotification } from "../lib/notify";

// ── Sovereign SearXNG search (private metasearch JSON → result rows) ──────────
interface SearchHit { title: string; content: string; url: string }

export const SEARCH_TIMEOUT_REASON = "Self-hosted search engine instance was temporarily unreachable.";
const SOVEREIGN_SEARCH_URL = process.env.SOVEREIGN_SEARCH_URL || "http://localhost:8080/search";

type SearchResult = { hits: SearchHit[]; unreachable: boolean };

async function searxng(query: string): Promise<SearchResult> {
  try {
    const url = `${SOVEREIGN_SEARCH_URL}?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, { headers: { Accept: "application/json", ...sovereignHeaders() } });
    if (!res.ok) {
      // 5xx → the index itself is down/unreachable; treat as an infra timeout.
      console.error(`[social-discovery] searxng HTTP ${res.status}`);
      return { hits: [], unreachable: res.status >= 500 };
    }
    // Same structural keys SearXNG returns under data.results.
    const data = (await res.json()) as { results?: { title?: string; content?: string; url?: string }[] };
    const hits = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? "", content: r.content ?? "", url: r.url as string }));
    return { hits, unreachable: false };
  } catch (e) {
    // Connection drop / DNS / timeout reaching the self-hosted instance.
    console.error("[social-discovery] searxng unreachable:", e instanceof Error ? e.message : String(e));
    return { hits: [], unreachable: true };
  }
}

// Wide-net query set per search type. Casting a broad net across the open web (general queries,
// directories, review sites, forums) massively out-performs a couple of narrow site: operators —
// that's what made earlier sweeps return "2 results then nothing". We over-generate queries; the
// dedupe + extraction stages downstream trim the noise.
function buildQueries(searchType: "INTENT_LEADS" | "REVIEWS", sector?: string, region?: string, targetSubject?: string): string[] {
  const loc = region ? ` ${region}` : "";
  if (searchType === "REVIEWS") {
    const subj = (targetSubject ?? sector ?? "").trim();
    return [
      `${subj} reviews${loc}`,
      `${subj} review${loc}`,
      `"${subj}" complaints OR scam OR "bad experience"`,
      `${subj} trustpilot`,
      `${subj} google reviews${loc}`,
      `${subj} customer feedback${loc}`,
      `${subj} testimonials${loc}`,
      `site:reddit.com ${subj} review`,
    ].filter(q => q.replace(/["']/g, "").trim().length > 6);
  }
  // INTENT_LEADS = find real people/businesses in a sector + region (leads/prospects).
  const s = (sector ?? "").trim();
  return [
    `${s}${loc}`,
    `top ${s}${loc}`,
    `best ${s}${loc}`,
    `${s}${loc} contact email`,
    `${s}${loc} directory`,
    `list of ${s}${loc}`,
    `${s}${loc} "get in touch" OR "contact us"`,
    `site:reddit.com ${s}${loc} recommendation OR "looking for"`,
  ].filter(q => q.replace(/["']/g, "").trim().length > 4);
}

interface ExtractedLead {
  source_url?: string;
  platform?: string;
  author_name?: string;
  raw_content?: string;
  intent_type?: "BUY_SIGNAL" | "REVIEW" | "COMPLAINT";
  target_subject?: string;
  region?: string;
  confidence_score?: number;
  // Contact details, extracted ONLY when present verbatim in the source (never invented).
  contact_email?: string;
  contact_phone?: string;
  handle?: string;
  summary?: string;
}

const LEAD_TOOL_SCHEMA: GatewayToolRequest["toolSchema"] = {
  type: "object",
  properties: {
    leads: {
      type: "array",
      description: "Only genuine, on-topic results. Drop ads, listicles, and anything off-topic or out-of-region.",
      items: {
        type: "object",
        properties: {
          source_url: { type: "string", description: "Exact URL the result came from (must be one of the provided URLs)" },
          platform: { type: "string", description: "X | Reddit | Google Reviews | other" },
          author_name: { type: "string", description: "The person's name if identifiable" },
          raw_content: { type: "string", description: "The relevant quote/snippet/review, verbatim" },
          intent_type: { type: "string", description: "BUY_SIGNAL | REVIEW | COMPLAINT" },
          target_subject: { type: "string", description: "The person/company being reviewed, if any" },
          region: { type: "string" },
          confidence_score: { type: "number", description: "0-100 how clearly this matches the search intent + region" },
          contact_email: { type: "string", description: "Email ONLY if it appears verbatim in the source text — else omit" },
          contact_phone: { type: "string", description: "Phone ONLY if it appears verbatim in the source text — else omit" },
          handle: { type: "string", description: "Social handle/username if present (e.g. @name)" },
          summary: { type: "string", description: "One-sentence note: who this is and why they're a lead" },
        },
        required: ["source_url", "intent_type"],
      },
    },
  },
};

export type DiscoveryParams = { workspaceId: string; region?: string; sector?: string; searchType: "INTENT_LEADS" | "REVIEWS"; targetSubject?: string };

// Core sweep — callable directly (from POST /discovery/run, so results don't depend on Inngest
// actually processing the event in prod) AND wrapped by the Inngest worker below for background runs.
export async function runSocialDiscovery(data: DiscoveryParams): Promise<Record<string, unknown>> {
    const { workspaceId, region, sector, searchType, targetSubject } = data;

    // 1) Parallel web sweep across the query operators (private SearXNG index).
    const queries = buildQueries(searchType, sector, region, targetSubject);
    const sweep = await Promise.all(queries.map((q) => searxng(q)));
    // Short-circuit on a connection drop / infra timeout rather than proceeding
    // with an empty payload.
    if (sweep.some((s) => s.unreachable)) {
      console.error("[social-discovery] " + SEARCH_TIMEOUT_REASON);
      return { status: "SKIPPED_INFRASTRUCTURE_TIMEOUT" as const, reason: SEARCH_TIMEOUT_REASON };
    }
    const hits = sweep.flatMap((s) => s.hits);
    if (hits.length === 0) return { discovered: 0, reason: "no search results", diag: { queries: queries.length, hits: 0, unique: 0, extracted: 0, matched: 0 } };

    // Dedupe the raw hits by URL before extraction.
    const seen = new Set<string>();
    const unique = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))).slice(0, 36);

    // Scrape the TOP pages to full text — SearXNG snippets alone are too thin for the model to find
    // real reviews/people/contacts (that was the "gateway ok → 0 extracted" dead-end). Best-effort:
    // any page that fails to render just falls back to its snippet.
    const SCRAPE_TOP = 12;
    const scraped = await Promise.all(unique.slice(0, SCRAPE_TOP).map((h) => sovereignScrape(h.url).catch(() => "")));
    const fullText = new Map<string, string>();
    unique.slice(0, SCRAPE_TOP).forEach((h, i) => { const md = scraped[i]; if (md) fullText.set(h.url, md.slice(0, 3500)); });

    // 2) Grounded extraction through the sovereign Cerebras gateway. Strict: the
    //    model may only return results built from the provided hits + URLs, must
    //    verify the region match, and must drop noise.
    const context = unique.map((h, i) => `[${i}] ${h.title}\n${fullText.get(h.url) || h.content}\nURL: ${h.url}`).join("\n\n");
    const wantReviews = searchType === "REVIEWS";
    // The AI gateway is rate-limited (shared per-minute quota with chat + enrichment). A single 429
    // used to zero the whole sweep — retry once after a short pause so a transient limit recovers.
    const runExtraction = () => aiGatewayToolUse({
      toolName: "extract_discovered_leads",
      toolDescription: "Extract clean, on-topic social-listening results from the search hits",
      toolSchema: LEAD_TOOL_SCHEMA,
      maxTokens: 2048,
      system:
        `You extract ${wantReviews ? "reviews, opinions, and complaints" : "buyer-intent signals and prospects"} from web pages. Be USEFUL — return every plausibly-relevant result, not just perfect ones. ` +
        `RULES: (1) every result's source_url MUST be copied verbatim from one of the provided URLs — never invent one. ` +
        `(2) Skip only pure ads and navigation/boilerplate. A ${wantReviews ? "review, testimonial, forum comment, or opinion about the subject" : "person or business showing interest or a need"} all count — include them. ` +
        `(3) ${region ? `Region "${region}" is a PREFERENCE, not a filter: keep results even if the region is unclear, just give them a lower confidence_score. Only drop a result if it clearly belongs to a different region.` : "Region is optional."} ` +
        `(4) intent_type is COMPLAINT for negative reviews, REVIEW for neutral/positive reviews/opinions, BUY_SIGNAL for purchase intent. ` +
        `(5) confidence_score (0-100) reflects how clearly the result matches. Include lower-confidence results too — do not return an empty array unless the pages truly contain nothing on-topic. ` +
        `(6) Fill contact_email / contact_phone / handle ONLY when they appear verbatim in the text — NEVER guess. Always write a one-sentence summary noting who this is and why they're relevant.`,
      prompt:
        `Search type: ${searchType}. Sector: "${sector ?? ""}". Region: "${region ?? ""}".` +
        `${targetSubject ? ` Target subject: "${targetSubject}".` : ""}\n\nSearch hits:\n${context}`,
    });
    let extracted: Record<string, unknown> = {};
    let gatewayReturned = false;
    let gatewayError: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        extracted = await runExtraction();
        gatewayReturned = Object.keys(extracted).length > 0;
        if (gatewayReturned) { gatewayError = null; break; }
      } catch (err: any) {
        gatewayError = (err?.message ?? String(err)).slice(0, 200); // surface the REAL reason in diag
        console.error(`[social-discovery] extraction gateway failed (attempt ${attempt + 1}):`, gatewayError);
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 4000)); // let any transient limit recover
    }
    const leads = Array.isArray((extracted as { leads?: unknown }).leads)
      ? ((extracted as { leads: ExtractedLead[] }).leads)
      : [];

    // Anti-hallucination: every lead's source_url must resolve to a URL we actually scanned. But
    // the model routinely returns a near-miss (adds/drops a trailing slash, http↔https, www.,
    // fragment) which previously nuked EVERY result. Normalize both sides and fuzzy-map back to
    // the exact scanned URL so genuine extractions survive.
    const normUrl = (u: string) => {
      try {
        const p = new URL(u.trim());
        const host = p.host.replace(/^www\./, "").toLowerCase();
        const path = p.pathname.replace(/\/+$/, "");
        return `${host}${path}${p.search}`.toLowerCase();
      } catch {
        return u.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
      }
    };
    const byNorm = new Map(unique.map((h) => [normUrl(h.url), h.url]));
    const rows = leads
      .map((l) => ({ l, resolved: l.source_url ? byNorm.get(normUrl(l.source_url)) : undefined }))
      .filter((x) => x.resolved && x.l.intent_type)
      .map(({ l, resolved }) => ({
        workspace_id: workspaceId,
        source_url: resolved!,
        // NOT NULL columns — always provide a value.
        platform: l.platform || "web",
        author_name: l.author_name || "Anonymous",
        raw_content: l.raw_content || "",
        intent_type: l.intent_type!,
        target_subject: l.target_subject ?? targetSubject ?? null,
        region: l.region ?? region ?? null,
        confidence_score: typeof l.confidence_score === "number" ? Math.max(0, Math.min(100, Math.round(l.confidence_score))) : 0,
        // Structured contact block (needs the `contact jsonb` column — 20260701 migration).
        contact: {
          email: l.contact_email?.trim() || null,
          phone: l.contact_phone?.trim() || null,
          handle: l.handle?.trim() || null,
          summary: l.summary?.trim() || null,
        },
      }));

    // Diagnostics so a thin result is explainable without prod logs: where did the pipeline drop?
    const diag = {
      queries: queries.length,
      hits: hits.length,
      unique: unique.length,
      scraped: fullText.size,     // pages we rendered to full text (vs snippet-only)
      gateway: gatewayReturned,   // false → the AI extraction call failed
      gateway_error: gatewayError, // the ACTUAL error (rate limit / timeout / payload) when it fails
      extracted: leads.length,    // leads the model returned
      matched: rows.length,       // survived the URL-resolution + intent filter
    };
    if (rows.length === 0) {
      const reason = !gatewayReturned ? `extraction failed${gatewayError ? `: ${gatewayError}` : ""}`
        : leads.length === 0 ? "model found no on-topic results in the scanned pages"
        : "extracted results didn't resolve to scanned URLs";
      return { discovered: 0, scanned: unique.length, reason, diag };
    }

    // Collapse rows that share a source_url — discovered_leads is UNIQUE on source_url, and Postgres
    // rejects an upsert that hits the same conflict target twice in one statement ("ON CONFLICT DO
    // UPDATE command cannot affect row a second time"). The model often returns several leads from
    // one page; keep the highest-confidence one per URL.
    const byUrl = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const prev = byUrl.get(r.source_url);
      if (!prev || (r.confidence_score ?? 0) > (prev.confidence_score ?? 0)) byUrl.set(r.source_url, r);
    }
    const dedupedRows = [...byUrl.values()];

    // 3) Upsert, deduping on source_url (a result seen before is refreshed, not duplicated).
    let { error } = await supabase.from("discovered_leads").upsert(dedupedRows, { onConflict: "source_url" });
    // Graceful degrade: if the `contact` column isn't migrated yet, retry without it so
    // discovery keeps working (the enriched fields just won't persist until the migration runs).
    if (error && /contact/i.test(error.message)) {
      const bare = dedupedRows.map(({ contact, ...r }) => r);
      ({ error } = await supabase.from("discovered_leads").upsert(bare, { onConflict: "source_url" }));
    }
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
      const strong = dedupedRows.filter((r) => (r.confidence_score ?? 0) >= 70 && (r.contact?.email || r.contact?.phone));
      if (strong.length) {
        // Dedup against already-pending discovery decisions (by source_url in their evidence).
        const { data: pending } = await supabase.from("decision_queue")
          .select("evidence").eq("workspace_id", workspaceId).eq("agent_name", "discovery").eq("status", "pending");
        const seenUrls = new Set((pending ?? []).flatMap((d) => Array.isArray(d.evidence) ? d.evidence.map((e: any) => e?.lead?.source_url) : []));
        for (const r of strong) {
          if (seenUrls.has(r.source_url)) continue;
          await supabase.from("decision_queue").insert({
            workspace_id: workspaceId,
            source_type: "discovered_lead",
            source_id: null,
            agent_name: "discovery",
            title: `Add ${r.author_name || "lead"} from Discovery?`,
            summary: r.contact?.summary || (r.raw_content || "").slice(0, 160) || "Discovered from the web",
            recommended_action: `Add "${r.author_name || "this lead"}" as a lead record`,
            risk_level: "low",
            evidence: [{
              type: "discovered_lead",
              title: r.author_name || "Lead",
              match_reason: `Confidence ${r.confidence_score ?? 0}${r.contact?.email ? ` · ${r.contact.email}` : ""}`,
              lead: { name: r.author_name, email: r.contact?.email ?? null, phone: r.contact?.phone ?? null, handle: r.contact?.handle ?? null, summary: r.contact?.summary ?? null, source_url: r.source_url, region: r.region, subject: r.target_subject },
            }],
          }).then(() => { queued++; }, () => {});
        }
      }
    }

    // 5) Agent notifies the workspace (best-effort, never blocks).
    if (dedupedRows.length > 0) {
      const what = searchType === "REVIEWS" ? "reviews/mentions" : "leads";
      await createNotification({
        workspace_id: workspaceId,
        type: "agent",
        title: `Discovery Agent found ${dedupedRows.length} ${what}`,
        body: `From ${unique.length} sources${sector ? ` for "${sector}"` : ""}${region ? ` in ${region}` : ""}${targetSubject ? ` about "${targetSubject}"` : ""}.` +
          (queued > 0 ? ` ${queued} strong lead${queued === 1 ? "" : "s"} queued in your Decision Queue for approval.` : " Review them in Discovery."),
        metadata: { source: "discovery", count: dedupedRows.length, queued, search_type: searchType },
      }).catch(() => {});
    }

    return { discovered: dedupedRows.length, scanned: unique.length, queued, diag };
}

export const socialDiscoveryWorker = inngest.createFunction(
  { id: "social-media-listening-discovery", name: "Social listening & intent discovery", concurrency: { limit: 3 } },
  { event: "app/social.discovery.trigger" },
  async ({ event }) => runSocialDiscovery(event.data),
);
