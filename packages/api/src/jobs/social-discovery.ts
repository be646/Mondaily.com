import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";
import { sovereignHeaders } from "../lib/sovereign-search";

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

// Advanced query operators per search type. Real estate agents looking for local
// buyers → INTENT_LEADS; brand/person sentiment → REVIEWS.
function buildQueries(searchType: "INTENT_LEADS" | "REVIEWS", sector?: string, region?: string, targetSubject?: string): string[] {
  const loc = region ? ` ${region}` : "";
  if (searchType === "REVIEWS") {
    const subj = targetSubject ?? sector ?? "";
    return [
      `site:reddit.com "${subj}" review`,
      `"${subj}" complaint OR scam OR "bad experience"${loc}`,
      `"${subj}" review${loc}`,
    ];
  }
  const s = sector ?? "";
  return [
    `site:reddit.com "${s}"${loc} ("looking to buy" OR "recommendation" OR "anyone know")`,
    `site:x.com "${s}"${loc} ("looking to buy" OR "in the market for" OR "recommend")`,
    `"${s}"${loc} ("looking to buy" OR "need a recommendation")`,
  ];
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
    if (hits.length === 0) return { discovered: 0, reason: "no search results" };

    // Dedupe the raw hits by URL before extraction.
    const seen = new Set<string>();
    const unique = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))).slice(0, 24);

    // 2) Grounded extraction through the sovereign Cerebras gateway. Strict: the
    //    model may only return results built from the provided hits + URLs, must
    //    verify the region match, and must drop noise.
    const context = unique.map((h, i) => `[${i}] ${h.title}\n${h.content}\nURL: ${h.url}`).join("\n\n");
    const wantReviews = searchType === "REVIEWS";
    const extracted = await aiGatewayToolUse({
      toolName: "extract_discovered_leads",
      toolDescription: "Extract clean, on-topic social-listening results from the search hits",
      toolSchema: LEAD_TOOL_SCHEMA,
      maxTokens: 2048,
      system:
        `You extract ${wantReviews ? "reviews/complaints" : "buyer-intent signals"} from raw web search hits. ` +
        `STRICT RULES: (1) every result's source_url MUST be copied verbatim from one of the provided URLs — never invent one. ` +
        `(2) Drop ads, SEO listicles, vendor pages, and anything that is not a genuine ${wantReviews ? "review or complaint" : "person expressing buying intent"}. ` +
        `(3) ${region ? `Only keep results that plausibly match the region "${region}"; drop the rest.` : "Region is optional."} ` +
        `(4) intent_type is COMPLAINT for negative reviews, REVIEW for neutral/positive reviews, BUY_SIGNAL for purchase intent. ` +
        `(5) confidence_score reflects how clearly the hit matches the intent and region. Return an empty array if nothing qualifies — never pad. ` +
        `(6) Fill contact_email / contact_phone / handle ONLY when they appear verbatim in the hit text — NEVER guess or construct them. Always write a one-sentence summary noting who the person is and why they're a lead.`,
      prompt:
        `Search type: ${searchType}. Sector: "${sector ?? ""}". Region: "${region ?? ""}".` +
        `${targetSubject ? ` Target subject: "${targetSubject}".` : ""}\n\nSearch hits:\n${context}`,
    }).catch((err: any) => {
      console.error("[social-discovery] extraction gateway call failed (non-fatal):", err?.message ?? err);
      return {} as Record<string, unknown>;
    });

    const leads = Array.isArray((extracted as { leads?: unknown }).leads)
      ? ((extracted as { leads: ExtractedLead[] }).leads)
      : [];

    // Only keep results whose source_url is one we actually searched (anti-hallucination).
    const validUrls = new Set(unique.map((h) => h.url));
    const rows = leads
      .filter((l) => l.source_url && validUrls.has(l.source_url) && l.intent_type)
      .map((l) => ({
        workspace_id: workspaceId,
        source_url: l.source_url!,
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

    if (rows.length === 0) return { discovered: 0, scanned: unique.length };

    // 3) Upsert, deduping on source_url (a result seen before is refreshed, not duplicated).
    let { error } = await supabase.from("discovered_leads").upsert(rows, { onConflict: "source_url" });
    // Graceful degrade: if the `contact` column isn't migrated yet, retry without it so
    // discovery keeps working (the enriched fields just won't persist until the migration runs).
    if (error && /contact/i.test(error.message)) {
      const bare = rows.map(({ contact, ...r }) => r);
      ({ error } = await supabase.from("discovered_leads").upsert(bare, { onConflict: "source_url" }));
    }
    if (error) {
      console.error("[social-discovery] upsert failed:", error.message);
      return { discovered: 0, scanned: unique.length, error: error.message };
    }

    return { discovered: rows.length, scanned: unique.length };
}

export const socialDiscoveryWorker = inngest.createFunction(
  { id: "social-media-listening-discovery", name: "Social listening & intent discovery", concurrency: { limit: 3 } },
  { event: "app/social.discovery.trigger" },
  async ({ event }) => runSocialDiscovery(event.data),
);
