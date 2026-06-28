import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";

// ── Tavily web search (one query → flattened result rows with their URLs) ──────
interface SearchHit { title: string; content: string; url: string }

async function tavily(query: string): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: 6, search_depth: "advanced" }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: { title?: string; content?: string; url?: string }[] };
    return (json.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? "", content: r.content ?? "", url: r.url as string }));
  } catch {
    return [];
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
          author_name: { type: "string" },
          raw_content: { type: "string", description: "The relevant quote/snippet, verbatim" },
          intent_type: { type: "string", description: "BUY_SIGNAL | REVIEW | COMPLAINT" },
          target_subject: { type: "string", description: "The person/company being reviewed, if any" },
          region: { type: "string" },
          confidence_score: { type: "number", description: "0-100 how clearly this matches the search intent + region" },
        },
        required: ["source_url", "intent_type"],
      },
    },
  },
};

export const socialDiscovery = inngest.createFunction(
  { id: "social-discovery", name: "Social listening & intent discovery", concurrency: { limit: 3 } },
  { event: "app/social.discovery.trigger" },
  async ({ event }) => {
    const { workspaceId, region, sector, searchType, targetSubject } = event.data;

    // 1) Parallel web sweep across the query operators.
    const queries = buildQueries(searchType, sector, region, targetSubject);
    const hitGroups = await Promise.all(queries.map((q) => tavily(q)));
    const hits = hitGroups.flat();
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
        `(5) confidence_score reflects how clearly the hit matches the intent and region. Return an empty array if nothing qualifies — never pad.`,
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
        platform: l.platform ?? null,
        author_name: l.author_name ?? null,
        raw_content: l.raw_content ?? null,
        intent_type: l.intent_type!,
        target_subject: l.target_subject ?? targetSubject ?? null,
        region: l.region ?? region ?? null,
        confidence_score: typeof l.confidence_score === "number" ? Math.max(0, Math.min(100, Math.round(l.confidence_score))) : null,
      }));

    if (rows.length === 0) return { discovered: 0, scanned: unique.length };

    // 3) Upsert, deduping on source_url (a result seen before is refreshed, not duplicated).
    const { error } = await supabase.from("discovered_leads").upsert(rows, { onConflict: "source_url" });
    if (error) {
      console.error("[social-discovery] upsert failed:", error.message);
      return { discovered: 0, scanned: unique.length, error: error.message };
    }

    return { discovered: rows.length, scanned: unique.length };
  },
);
