import { inngest, type Events } from "../lib/inngest";
import { startJob, completeJob, failJob, logStep } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";

const ENRICHABLE = ["contact", "person", "people", "lead", "company", "account", "organization"];

/**
 * Flatten the structured enrichment groups into the flat top-level keys the
 * records sheet / pipeline columns read (job_title, company, email, …), while
 * keeping the grouped objects + arrays for richer detail surfaces.
 */
function flattenEnrichment(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lift = (group: unknown) => {
    if (group && typeof group === "object" && !Array.isArray(group)) {
      for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
        if (v != null && v !== "" && out[k] == null) out[k] = v;
      }
    }
  };
  lift(fields.professional_background);
  lift(fields.company_firmographic_data);
  lift(fields.verified_contact); // email, phone, source → top level
  // Keep the rich structures available too (detail views / future surfaces).
  if (fields.verified_intent_signals) out.intent_signals = fields.verified_intent_signals;
  if (fields.calculated_churn_risk) out.churn_risk = fields.calculated_churn_risk;
  // Preserve any already-flat keys the model returned directly.
  for (const [k, v] of Object.entries(fields)) {
    if (["professional_background", "company_firmographic_data", "verified_contact", "verified_intent_signals", "calculated_churn_risk"].includes(k)) continue;
    if (v != null && v !== "" && out[k] == null) out[k] = v;
  }
  return out;
}

// ── Sovereign search + deep extraction ──────────────────────────────────────
// Self-hosted SearXNG (private metasearch → JSON results) + crw (JS-render
// scraper → ad-free Markdown). No third-party search meter.
const SOVEREIGN_SEARCH_URL = process.env.SOVEREIGN_SEARCH_URL || "http://localhost:8080/search";
const SOVEREIGN_SCRAPE_URL = process.env.SOVEREIGN_SCRAPE_URL || "http://localhost:3000/v2/scrape";

/** Query the private SearXNG index → top result URLs. */
async function searxngUrls(query: string, limit = 4): Promise<string[]> {
  try {
    const url = `${SOVEREIGN_SEARCH_URL}?q=${encodeURIComponent(query)}&format=json&engines=google,reddit`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.error(`[search] searxng HTTP ${res.status}`);
      return [];
    }
    const data = await res.json() as { results?: { url?: string }[] };
    return (data.results ?? []).map(r => r.url).filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, limit);
  } catch (e) {
    console.error("[search] searxng error:", e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** Render + convert one page to clean Markdown via the self-hosted scraper. */
async function scrapeMarkdown(targetUrl: string): Promise<string> {
  try {
    const res = await fetch(SOVEREIGN_SCRAPE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: targetUrl, formats: ["markdown"] }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { markdown?: string; content?: string; data?: { markdown?: string; content?: string } };
    return data.markdown ?? data.data?.markdown ?? data.content ?? data.data?.content ?? "";
  } catch {
    return "";
  }
}

/** Full sweep: private search → scrape the top pages → joined Markdown context. */
async function sovereignSearch(query: string): Promise<string> {
  const urls = await searxngUrls(query);
  if (urls.length === 0) return "";
  const pages = await Promise.all(
    urls.slice(0, 3).map(u => scrapeMarkdown(u).then(md => (md ? `Source: ${u}\n${md.slice(0, 1500)}` : ""))),
  );
  return pages.filter(Boolean).join("\n\n");
}

async function extractFields(prompt: string, toolName: string, toolSchema: object): Promise<Record<string, unknown>> {
  // Local fail-safe (matches the other jobs): a gateway timeout / missing-config
  // throw degrades to "no fields enriched" rather than throwing into the Inngest
  // worker, so a provider hiccup never crashes the enrichment run.
  const raw = await aiGatewayToolUse({
    prompt,
    toolName,
    toolDescription: "Extract enrichment fields",
    toolSchema: toolSchema as GatewayToolRequest["toolSchema"],
    maxTokens: 512,
  }).catch((err: any) => {
    console.error("[enrich-record] gateway call failed (non-fatal):", err?.message ?? err);
    return {} as Record<string, unknown>;
  });
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== ""));
}

export const enrichRecord = inngest.createFunction(
  { id: "crm-enrich-record", name: "CRM: Enrich Record", concurrency: { limit: 5 } },
  { event: "crm/record.created" },
  async ({ event }) => {
    const { workspaceId, nodeId, objectType, recordData } = event.data;

    const normalizedType = objectType.toLowerCase();
    if (!ENRICHABLE.some(t => normalizedType.includes(t))) {
      return { skipped: true, reason: "object_type not enrichable" };
    }

    // startJob is inside the try too — if the agent_jobs insert itself throws,
    // it must not escape the handler and trigger Inngest's retry flood.
    let jobId: string | undefined;
    try {
      jobId = await startJob({
        workspace_id: workspaceId,
        agent_name: "crm_enricher",
        trigger_type: "signal",
        input: { nodeId, objectType, recordData },
        node_ids: [nodeId],
      });

      const isPerson = ["contact", "person", "people", "lead"].some(t => normalizedType.includes(t));
      let fields: Record<string, unknown> = {};

      if (isPerson) {
        const email = (recordData.email ?? recordData.Email ?? "") as string;
        const name = (recordData.name ?? recordData.Name ?? "") as string;
        const subject = email || name;

        // Multi-source sweep: profile + signals + a dedicated contact-details pass.
        // All are REAL web searches — nothing is fabricated; the model may only use
        // text returned here.
        const company = (recordData.company ?? "") as string;
        const profileQuery = email ? `${email} linkedin job title company` : `${name} linkedin job title company professional`;
        const signalQuery = `${subject} ${company} news role change hiring recent`;
        const contactQuery = `${name} ${company} email address phone contact`;
        await logStep(jobId, { step: "web_sweep", queries: [profileQuery, signalQuery, contactQuery] });
        const sweep = await Promise.all([
          sovereignSearch(profileQuery), sovereignSearch(signalQuery), sovereignSearch(contactQuery),
        ]);
        const webContext = sweep.filter(Boolean).join("\n\n");

        await logStep(jobId, { step: "extract", type: "person" });
        fields = await extractFields(
          `Enrich this person from the web context below. Name: "${name}", Email: "${email}".\n` +
          `STRICT: fill ONLY fields the web context supports. OMIT anything you cannot ground in the context — never invent values. ` +
          `For verified_contact: only include an email or phone that literally appears in the web context, and ALWAYS cite the source URL it came from. Never guess an email pattern (e.g. first.last@company.com) — if it isn't stated, omit it. ` +
          `verified_intent_signals must each cite where the signal came from. calculated_churn_risk is your estimate from the signals only; omit it if there isn't enough signal.\n` +
          `${webContext ? `Web context:\n${webContext}` : "No web context found — return only fields you are certain of from the input."}`,
          "enrich_person",
          {
            type: "object",
            properties: {
              professional_background: {
                type: "object",
                description: "Verified role/profile facts from the web",
                properties: {
                  job_title: { type: "string" },
                  seniority: { type: "string", description: "e.g. IC / manager / director / VP / C-level" },
                  company:   { type: "string" },
                  location:  { type: "string" },
                  linkedin:  { type: "string" },
                  twitter:   { type: "string" },
                  summary:   { type: "string", description: "1-2 sentence professional bio" },
                },
              },
              verified_contact: {
                type: "object",
                description: "Contact details that LITERALLY appear in the web context, each with its source. Omit any you cannot find verbatim — never guess an email/phone pattern.",
                properties: {
                  email:  { type: "string" },
                  phone:  { type: "string" },
                  source: { type: "string", description: "URL where the email/phone was found" },
                },
              },
              verified_intent_signals: {
                type: "array",
                description: "Source-backed signals (role change, hiring, funding, expansion). Empty if none found.",
                items: { type: "object", properties: { signal: { type: "string" }, source: { type: "string" } } },
              },
              calculated_churn_risk: {
                type: "object",
                description: "Estimated, derived only from the signals above",
                properties: { level: { type: "string", description: "low | medium | high" }, rationale: { type: "string" } },
              },
            },
          },
        );
      } else {
        const name = (recordData.name ?? recordData.Name ?? recordData.company_name ?? "") as string;
        const domain = (recordData.domain ?? recordData.website ?? "") as string;

        // Multi-source sweep: a firmographic pass + a news/signals pass.
        const firmoQuery = `${name} ${domain} company funding employees revenue industry headquarters`;
        const signalQuery = `${name} news hiring funding round expansion layoffs ${new Date().getFullYear()}`;
        await logStep(jobId, { step: "web_sweep", queries: [firmoQuery, signalQuery] });
        const sweep = await Promise.all([sovereignSearch(firmoQuery), sovereignSearch(signalQuery)]);
        const webContext = sweep.filter(Boolean).join("\n\n");

        await logStep(jobId, { step: "extract", type: "company" });
        fields = await extractFields(
          `Enrich this company from the web context below. Name: "${name}", Domain: "${domain}".\n` +
          `STRICT: fill ONLY fields the web context supports. OMIT anything you cannot ground — never invent numbers. ` +
          `verified_intent_signals must each cite a source. calculated_churn_risk is your estimate from the signals only; omit it if there isn't enough signal.\n` +
          `${webContext ? `Web context:\n${webContext}` : "No web context found — return only fields you are certain of."}`,
          "enrich_company",
          {
            type: "object",
            properties: {
              company_firmographic_data: {
                type: "object",
                description: "Verified firmographics from the web",
                properties: {
                  industry:       { type: "string" },
                  employee_range: { type: "string" },
                  arr:            { type: "number" },
                  funding_raised: { type: "number" },
                  founded_year:   { type: "number" },
                  country:        { type: "string" },
                  website:        { type: "string" },
                  description:    { type: "string" },
                },
              },
              verified_intent_signals: {
                type: "array",
                description: "Source-backed signals (funding, hiring, expansion, layoffs). Empty if none found.",
                items: { type: "object", properties: { signal: { type: "string" }, source: { type: "string" } } },
              },
              calculated_churn_risk: {
                type: "object",
                description: "Estimated, derived only from the signals above",
                properties: { level: { type: "string", description: "low | medium | high" }, rationale: { type: "string" } },
              },
            },
          },
        );
      }

      if (Object.keys(fields).length === 0) {
        await failJob(jobId, "No fields extracted");
        return { enriched: false };
      }

      // Flatten the structured groups to TOP-LEVEL keys so the records sheet /
      // pipeline (which read flat columns like job_title, company, email) actually
      // display them. The grouped objects are kept too, for richer detail views.
      const flat = flattenEnrichment(fields);

      // Merge enriched fields into node data
      const { data: node } = await supabase.from("nodes").select("data").eq("id", nodeId).single();
      const merged = { ...(node?.data ?? {}), ...flat };
      // Save data first (always works)
      await supabase.from("nodes").update({ data: merged }).eq("id", nodeId);
      // Save enrichment status columns (requires migration 0010)
      await supabase.from("nodes").update({ enriched_at: new Date().toISOString(), enrichment_status: "done" }).eq("id", nodeId);

      // Create notification for the workspace — summarize the FLAT keys actually written.
      const flatKeys = Object.keys(flat);
      const summary = flatKeys.slice(0, 3).join(", ");
      await supabase.from("notifications").insert({
        workspace_id: workspaceId,
        type: "agent",
        title: "✦ Record enriched",
        body: `AI filled in: ${summary}${flatKeys.length > 3 ? ` +${flatKeys.length - 3} more` : ""}`,
        metadata: { nodeId, object_type: objectType, fields_added: flatKeys.length },
      });

      await completeJob(jobId, { fields_added: flatKeys.length, fields: flat }, []);
      return { enriched: true, fields_count: Object.keys(fields).length };
    } catch (err: unknown) {
      // Best-effort enrichment: do NOT re-throw. Re-throwing turned every failure
      // into a 500 that Inngest retried indefinitely (a flood of 500s on
      // crm-enrich-record). Log it, mark the job failed, and end the run cleanly.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[enrich-record] failed for node ${nodeId} (non-fatal):`, msg);
      if (jobId) await failJob(jobId, msg).catch(() => {});
      return { enriched: false, error: msg };
    }
  },
);
