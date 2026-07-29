import { inngest, type Events } from "../lib/inngest";
import { sovereignSearchUrls, sovereignScrape } from "../lib/sovereign-search";
import { startJob, completeJob, failJob, logStep, step } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";
import { createNotification } from "../lib/notify";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";

const ENRICHABLE = ["contact", "person", "people", "lead", "company", "account", "organization"];

/**
 * Flatten the structured enrichment groups into the flat top-level keys the
 * records sheet / pipeline columns read (job_title, company, email, …), while
 * keeping the grouped objects + arrays for richer detail surfaces.
 */
/**
 * A key is only allowed onto a record if it is one WE named. The model sometimes returns an object
 * keyed by a property's `description` rather than its name, and the old "preserve any already-flat
 * keys" pass wrote those straight through — so 28 person records grew columns literally called
 * "Verified role/profile facts from the web" and "Contact details that LITERALLY appear in the web
 * context…". Same failure shape as the rest of this session: the code was right about what the
 * provider returned and wrong about what it MEANT.
 *
 * This is the schema's own property names, flattened the way flattenEnrichment flattens them, plus
 * the two renamed structures. Nothing else reaches nodes.data.
 */
const ALLOWED_ENRICHMENT_KEYS = new Set([
  // professional_background
  "job_title", "seniority", "company", "location", "linkedin", "twitter", "summary",
  // company_firmographic_data
  "industry", "employee_range", "arr", "funding_raised", "founded_year", "country", "website", "description",
  // verified_contact
  "email", "phone", "source",
  // renamed structures
  "intent_signals", "churn_risk",
]);

export function flattenEnrichment(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  const lift = (group: unknown) => {
    if (group && typeof group === "object" && !Array.isArray(group)) {
      for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
        if (!ALLOWED_ENRICHMENT_KEYS.has(k)) { dropped.push(k); continue; }
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
  // Preserve already-flat keys the model returned directly — but only ones we named. An unknown key
  // here is not a bonus field, it is the model having misread the schema.
  for (const [k, v] of Object.entries(fields)) {
    if (["professional_background", "company_firmographic_data", "verified_contact", "verified_intent_signals", "calculated_churn_risk"].includes(k)) continue;
    if (!ALLOWED_ENRICHMENT_KEYS.has(k)) { dropped.push(k); continue; }
    if (v != null && v !== "" && out[k] == null) out[k] = v;
  }
  // Say so rather than swallowing it. A silent drop here would hide a degraded provider response.
  if (dropped.length) {
    console.warn(`[enrich-record] dropped ${dropped.length} off-schema key(s) from the model response:`,
      dropped.map(k => k.slice(0, 60)));
  }
  return out;
}

// ── Sovereign search + deep extraction ──────────────────────────────────────
// Routes through the SHARED appliance client (lib/sovereign-search): same fail-loud behavior in
// production (no unconditional localhost default that can't exist on Vercel), same bearer auth,
// same reliable engine pinning, and the 24h scrape cache. This file previously carried its own
// duplicate fetch client with a prod localhost fallback and a stale scrape port.

/** Full sweep: private search → scrape the top pages → joined, URL-attributed Markdown context. */
async function sovereignSearch(query: string): Promise<string> {
  const urls = await sovereignSearchUrls(query, 4);
  if (urls.length === 0) return "";
  const pages = await Promise.all(
    urls.slice(0, 3).map(u => sovereignScrape(u).then(md => (md ? `Source: ${u}\n${md.slice(0, 1500)}` : ""))),
  );
  return pages.filter(Boolean).join("\n\n");
}

type UsageAcc = { prompt_tokens: number; completion_tokens: number; total_tokens: number; reasoning_tokens: number };

async function extractFields(prompt: string, toolName: string, toolSchema: object, onUsage?: GatewayToolRequest["onUsage"]): Promise<Record<string, unknown>> {
  // Local fail-safe (matches the other jobs): a gateway timeout / missing-config
  // throw degrades to "no fields enriched" rather than throwing into the Inngest
  // worker, so a provider hiccup never crashes the enrichment run.
  const raw = await aiGatewayToolUse({
    prompt,
    toolName,
    toolDescription: "Extract enrichment fields",
    toolSchema: toolSchema as GatewayToolRequest["toolSchema"],
    maxTokens: 512,
    onUsage,
  }).catch((err: any) => {
    console.error("[enrich-record] gateway call failed (non-fatal):", err?.message ?? err);
    return {} as Record<string, unknown>;
  });
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== ""));
}

export const enrichRecord = inngest.createFunction(
  { id: "crm-enrich-record", name: "Enrich Record", concurrency: { limit: 5 } },
  { event: "crm/record.created" },
  async ({ event }) => {
    const { workspaceId, nodeId, objectType } = event.data;
    // recordData may be absent on the event — default it so we never crash on
    // `recordData.email` (this was 500+ 'Cannot read properties of undefined' fails).
    let recordData = (event.data.recordData ?? {}) as Record<string, unknown>;

    const normalizedType = String(objectType ?? "").toLowerCase();
    if (!normalizedType || !ENRICHABLE.some(t => normalizedType.includes(t))) {
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

      // If the event carried no record data, load it from the node so enrichment
      // has real fields to work from instead of nothing.
      if (Object.keys(recordData).length === 0 && nodeId) {
        const { data: n } = await supabase.from("nodes").select("data").eq("id", nodeId).single();
        recordData = (n?.data ?? {}) as Record<string, unknown>;
      }

      const isPerson = ["contact", "person", "people", "lead"].some(t => normalizedType.includes(t));
      let fields: Record<string, unknown> = {};
      // Accumulate REAL Cerebras token usage across this run's extraction calls → output.usage,
      // which the ops center reads to show a genuine Tokens/sec (no fabricated number).
      const usage: UsageAcc = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reasoning_tokens: 0 };
      const collect: GatewayToolRequest["onUsage"] = (u) => {
        usage.prompt_tokens += u.prompt_tokens; usage.completion_tokens += u.completion_tokens;
        usage.total_tokens += u.total_tokens; usage.reasoning_tokens += u.reasoning_tokens;
      };

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
          collect,
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
          collect,
        );
      }

      if (Object.keys(fields).length === 0) {
        // No source data to extract from (the self-hosted search appliance may be
        // offline, or the record genuinely has nothing to enrich). This is a clean
        // SKIP, not a failure — don't pollute the agent's error count.
        await completeJob(jobId, { enriched: false, skipped: true, reason: "no source data found (search appliance may be offline)" }, [step("Searched sources — no usable data found", { status: "info" }), step("Skipped cleanly (0 fields written)", { status: "info" })]);
        return { enriched: false, reason: "no_data" };
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
      await createNotification({
        workspace_id: workspaceId,
        type: "agent",
        title: "✦ Record enriched",
        body: `AI filled in: ${summary}${flatKeys.length > 3 ? ` +${flatKeys.length - 3} more` : ""}`,
        metadata: { fields_added: flatKeys.length },
        source: { source_agent: "graph-enrichment", agent_job_id: jobId, node_id: nodeId, object_type: objectType },
      });

      await completeJob(jobId, { fields_added: flatKeys.length, fields: flat, usage }, [step(`Extracted ${flatKeys.length} field(s) from sources`), step(`Wrote ${flatKeys.length} field(s) to the record`, { status: "ok" })]);
      return { enriched: true, fields_count: Object.keys(fields).length };
    } catch (err: unknown) {
      // Best-effort enrichment: do NOT re-throw. Re-throwing turned every failure
      // into a 500 that Inngest retried indefinitely (a flood of 500s on
      // crm-enrich-record). Log it, mark the job failed, and end the run cleanly.
      const msg = err instanceof Error ? err.message : String(err);
      // A 429 / rate-limit is transient (the shared Cerebras per-minute quota) — a
      // clean skip that retries on the next scheduled run, NOT a real failure.
      if (/\b429\b|rate limit/i.test(msg)) {
        console.warn(`[enrich-record] rate-limited for node ${nodeId} — skipping this run`);
        if (jobId) await completeJob(jobId, { enriched: false, skipped: true, reason: "rate limited — will retry next run" }, [step("AI provider rate-limited — skipped, will retry next run", { status: "warn" })]).catch(() => {});
        return { enriched: false, reason: "rate_limited" };
      }
      console.error(`[enrich-record] failed for node ${nodeId} (non-fatal):`, msg);
      if (jobId) await failJob(jobId, msg).catch(() => {});
      return { enriched: false, error: msg };
    }
  },
);
