import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";
import { sovereignHeaders, sovereignScrape } from "../lib/sovereign-search";
import { createNotification } from "../lib/notify";
import { createHash } from "node:crypto";

// Stable per-review fingerprint — url + author + content snippet. Distinct reviews (different text)
// get different fingerprints and are all kept; a re-scan of the same review updates in place.
const leadFingerprint = (url: string, author: string, content: string) =>
  createHash("md5").update(`${url}|${author}|${(content || "").slice(0, 200)}`).digest("hex");

// ── Sovereign SearXNG search (private metasearch JSON → result rows) ──────────
interface SearchHit { title: string; content: string; url: string }

export const SEARCH_TIMEOUT_REASON = "Self-hosted search engine instance was temporarily unreachable.";
const SOVEREIGN_SEARCH_URL = process.env.SOVEREIGN_SEARCH_URL || "http://localhost:8080/search";

type SearchResult = { hits: SearchHit[]; unreachable: boolean };

async function searxng(query: string): Promise<SearchResult> {
  try {
    // language=en-US — the appliance sits on a German Hetzner IP, so without this bing geo-localizes
    // every query to Germany (verified live: "real estate agents London" returned German supermarket
    // pages). Discovery queries are English; pin the locale.
    const url = `${SOVEREIGN_SEARCH_URL}?q=${encodeURIComponent(query)}&format=json&language=en-US`;
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
// directories, review sites, forums, AND every major social network via site: operators — the
// engines index social pages even when the platforms block direct crawling) massively
// out-performs a couple of narrow queries. We over-generate; dedupe + per-page extraction
// downstream trim the noise.
function buildQueries(searchType: "INTENT_LEADS" | "REVIEWS", sector?: string, region?: string, targetSubject?: string): string[] {
  const loc = region ? ` ${region}` : "";
  if (searchType === "REVIEWS") {
    const subj = (targetSubject ?? sector ?? "").trim();
    return [
      `${subj} reviews${loc}`,
      `"${subj}" complaints OR scam OR "bad experience"`,
      `${subj} trustpilot OR google reviews${loc}`,
      `${subj} customer feedback OR testimonials${loc}`,
      `site:reddit.com ${subj} review`,
      `site:x.com OR site:twitter.com ${subj}`,
      `site:facebook.com ${subj} review`,
      `site:instagram.com ${subj}`,
      `site:linkedin.com ${subj}`,
      `site:youtube.com ${subj} review`,
    ].filter(q => q.replace(/["']/g, "").trim().length > 6);
  }
  // INTENT_LEADS = find real people/businesses in a sector + region (leads/prospects).
  const s = (sector ?? "").trim();
  return [
    `${s}${loc}`,
    `top ${s}${loc}`,
    `best ${s}${loc}`,
    `${s}${loc} contact email OR phone`,
    `${s}${loc} directory`,
    `list of ${s}${loc}`,
    `site:linkedin.com ${s}${loc}`,
    `site:x.com OR site:twitter.com ${s}${loc}`,
    `site:instagram.com ${s}${loc}`,
    `site:facebook.com ${s}${loc}`,
    `site:reddit.com ${s}${loc} recommendation OR "looking for"`,
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

export type DiscoveryParams = { workspaceId: string; region?: string; sector?: string; searchType: "INTENT_LEADS" | "REVIEWS"; targetSubject?: string; deep?: boolean };

/** Live progress callback — the streaming endpoint forwards these to the browser as SSE events so
 *  the user watches the agent work (searching → reading pages → finding leads) instead of a spinner. */
export type DiscoveryProgress = (ev: Record<string, unknown>) => void | Promise<void>;

// Core sweep — callable directly (from POST /discovery/run, so results don't depend on Inngest
// actually processing the event in prod) AND wrapped by the Inngest worker below for background runs.
export async function runSocialDiscovery(data: DiscoveryParams, onProgress?: DiscoveryProgress): Promise<Record<string, unknown>> {
    const { workspaceId, region, sector, searchType, targetSubject, deep } = data;
    const emit = async (ev: Record<string, unknown>) => { try { await onProgress?.(ev); } catch { /* progress is best-effort */ } };

    // 1) Web sweep across the query operators (private SearXNG index). STAGGERED in small batches —
    //    firing 10+ queries at bing/qwant simultaneously from one IP trips their rate limits, which
    //    SearXNG then reports as "Suspended: too many requests" and every later query returns 0.
    //    Verified live: rapid-fire parallel queries suspended qwant + wikipedia within seconds.
    const queries = buildQueries(searchType, sector, region, targetSubject);
    await emit({ type: "progress", stage: "search", message: `Searching the web across ${queries.length} query angles…` });
    const sweep: SearchResult[] = [];
    for (let i = 0; i < queries.length; i += 3) {
      const batch = queries.slice(i, i + 3);
      sweep.push(...await Promise.all(batch.map((q) => searxng(q))));
      if (i + 3 < queries.length) await new Promise((r) => setTimeout(r, 700));
    }
    // Short-circuit on a connection drop / infra timeout rather than proceeding
    // with an empty payload.
    if (sweep.some((s) => s.unreachable)) {
      console.error("[social-discovery] " + SEARCH_TIMEOUT_REASON);
      return { status: "SKIPPED_INFRASTRUCTURE_TIMEOUT" as const, reason: SEARCH_TIMEOUT_REASON };
    }
    const hits = sweep.flatMap((s) => s.hits);
    if (hits.length === 0) return { discovered: 0, reason: "no search results", diag: { queries: queries.length, hits: 0, unique: 0, extracted: 0, matched: 0 } };
    await emit({ type: "progress", stage: "search", message: `Found ${hits.length} candidate pages — reading the most promising…` });

    // Dedupe the raw hits by URL before extraction. Prefer scraping social/review pages first —
    // they're where the actual people/reviews live; generic pages fill the remaining slots.
    const seen = new Set<string>();
    const uniqueAll = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
    const socialFirst = [...uniqueAll].sort((a, b) => {
      const rank = (u: string) => (platformOf(u) === "web" || platformOf(u).includes(".") ? 1 : 0);
      return rank(a.url) - rank(b.url);
    });
    const unique = socialFirst.slice(0, 40);

    // 2) Scrape the top pages to full text, then run ONE FOCUSED extraction call PER PAGE, in
    //    parallel batches. This replaces the old single-blob call (36 concatenated pages in one
    //    prompt), which overwhelmed the model into returning 1-2 results — and because WE bind each
    //    extraction to its page's URL, the model never writes a source_url at all: hallucinated or
    //    mismatched URLs are structurally impossible, so nothing gets dropped by URL-matching.
    const SCRAPE_TOP = 18;
    const toScrape = unique.slice(0, SCRAPE_TOP);
    await emit({ type: "progress", stage: "scrape", message: `Reading ${toScrape.length} pages in full…` });
    const scraped = await Promise.all(toScrape.map((h) => sovereignScrape(h.url).catch(() => "")));
    const pages = unique.map((h, i) => ({
      url: h.url,
      title: h.title,
      text: (i < SCRAPE_TOP && scraped[i] ? scraped[i]! : h.content).slice(0, 6000),
    })).filter((p) => p.text.trim().length > 60); // nothing meaningful to extract from
    await emit({ type: "progress", stage: "extract", message: `Analyzing ${pages.length} pages with the agent…` });

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
    const extractPage = async (p: { url: string; title: string; text: string }): Promise<(ExtractedLead & { source_url: string })[]> => {
      try {
        const out = await aiGatewayToolUse({
          toolName: "extract_from_page",
          toolDescription: "Extract real leads/reviews from one web page",
          toolSchema: perPageSchema,
          maxTokens: 1600,
          system:
            `You extract REAL ${wantReviews ? "reviews and opinions" : "leads and prospects"} from a single web page. ` +
            `ABSOLUTE RULES: only report what is literally on the page — never invent names, emails, phones, or review text. ` +
            `Contact details ONLY when they appear verbatim. ${region ? `Region "${region}" is a preference, not a hard filter — keep unclear-region results at lower confidence.` : ""} ` +
            `Return an empty array if the page genuinely has nothing on-topic. Do not pad.`,
          prompt: `${ask}\n\nPAGE TITLE: ${p.title}\nPAGE URL: ${p.url}\n\nPAGE CONTENT:\n${p.text}`,
        });
        const leads = Array.isArray((out as { leads?: unknown }).leads) ? (out as { leads: ExtractedLead[] }).leads : [];
        return leads.filter((l) => l.intent_type).map((l) => ({ ...l, source_url: p.url }));
      } catch (err: any) {
        gatewayFailures++;
        lastGatewayError = (err?.message ?? String(err)).slice(0, 200);
        return [];
      }
    };

    // Parallel in batches of 6 — fast without slamming the AI provider all at once.
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

    // 5) AI OVERVIEW — a grounded read of what was found (the "Google AI mode" panel). Built from
    //    the ACTUAL extracted rows only; the model is forbidden from adding anything not in them.
    let overview: string | null = null;
    if (dedupedRows.length >= 2) {
      await emit({ type: "progress", stage: "overview", message: "Writing the AI overview of what was found…" });
      const digest = dedupedRows.slice(0, 30).map((r) =>
        `- [${r.intent_type}] ${r.author_name} (${r.platform}${r.region ? `, ${r.region}` : ""}, conf ${r.confidence_score})` +
        `${r.contact.email ? ` email:${r.contact.email}` : ""}${r.contact.phone ? ` phone:yes` : ""}: ${(r.contact.summary || r.raw_content || "").slice(0, 140)}`
      ).join("\n");
      try {
        const { aiGateway } = await import("../lib/ai-gateway");
        const { text } = await aiGateway({
          system:
            "You summarize web-discovery results for a business user. Write 2-4 short sentences describing ONLY what the findings below show — counts, platforms, contactability, and (for reviews) the sentiment balance. " +
            "NEVER add a fact, name, or number that is not in the findings. Plain language, no preamble, no markdown headers.",
          prompt: `Search: ${searchType === "REVIEWS" ? `reviews about "${targetSubject ?? sector}"` : `leads in "${sector}"`}${region ? ` (${region})` : ""}. Findings (${dedupedRows.length} total, first 30 shown):\n${digest}`,
          maxTokens: 260,
        });
        overview = (text || "").trim() || null;
        if (overview) await emit({ type: "overview", text: overview });
      } catch { /* overview is a bonus — never fail the sweep for it */ }
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
        metadata: { source: "discovery", count: dedupedRows.length, queued, search_type: searchType },
      }).catch(() => {});
    }

    // Compact display rows for the chat UI — exactly what was found THIS turn (no global refetch,
    // no fabricated fields). Ordered strongest-first.
    const results = [...dedupedRows]
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))
      .slice(0, 60)
      .map((r) => ({
        source_url: r.source_url,
        platform: r.platform,
        author_name: r.author_name,
        intent_type: r.intent_type,
        sentiment: r.contact?.sentiment ?? null,
        confidence_score: r.confidence_score ?? 0,
        region: r.region,
        target_subject: r.target_subject,
        snippet: (r.contact?.summary || r.raw_content || "").slice(0, 400),
        email: r.contact?.email ?? null,
        phone: r.contact?.phone ?? null,
        handle: r.contact?.handle ?? null,
      }));

    return { discovered: dedupedRows.length, scanned: unique.length, queued, overview, kind: searchType, results, diag };
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
        metadata: { source: "discovery_monitor", monitor_id: m.id, new: fresh },
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
