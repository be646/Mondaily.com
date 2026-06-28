import { inngest, type Events } from "../lib/inngest";
import { startJob, completeJob, failJob, logStep } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, type GatewayToolRequest } from "../lib/ai-gateway";

const ENRICHABLE = ["contact", "person", "people", "lead", "company", "account", "organization"];

async function tavilySearch(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return "";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: 4, search_depth: "basic" }),
    });
    if (!res.ok) return "";
    const json = await res.json() as { results?: { title: string; content: string }[] };
    return (json.results ?? []).slice(0, 4).map(r => `${r.title}: ${r.content}`).join("\n");
  } catch {
    return "";
  }
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

    const jobId = await startJob({
      workspace_id: workspaceId,
      agent_name: "crm_enricher",
      trigger_type: "signal",
      input: { nodeId, objectType, recordData },
      node_ids: [nodeId],
    });

    try {
      const isPerson = ["contact", "person", "people", "lead"].some(t => normalizedType.includes(t));
      let fields: Record<string, unknown> = {};

      if (isPerson) {
        const email = (recordData.email ?? recordData.Email ?? "") as string;
        const name = (recordData.name ?? recordData.Name ?? "") as string;
        const subject = email || name;

        // Multi-source sweep: a professional-profile pass + a signals pass. Both
        // are REAL web searches — nothing is fabricated; the model may only use
        // text returned here.
        const profileQuery = email ? `${email} linkedin job title company` : `${name} linkedin job title company professional`;
        const signalQuery = `${subject} ${recordData.company ?? ""} news role change hiring recent`;
        await logStep(jobId, { step: "web_sweep", queries: [profileQuery, signalQuery] });
        const [profileCtx, signalCtx] = await Promise.all([tavilySearch(profileQuery), tavilySearch(signalQuery)]);
        const webContext = [profileCtx, signalCtx].filter(Boolean).join("\n");

        await logStep(jobId, { step: "extract", type: "person" });
        fields = await extractFields(
          `Enrich this person from the web context below. Name: "${name}", Email: "${email}".\n` +
          `STRICT: fill ONLY fields the web context supports. OMIT anything you cannot ground in the context — never invent values. ` +
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
        const [firmoCtx, signalCtx] = await Promise.all([tavilySearch(firmoQuery), tavilySearch(signalQuery)]);
        const webContext = [firmoCtx, signalCtx].filter(Boolean).join("\n");

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

      // Merge enriched fields into node data
      const { data: node } = await supabase.from("nodes").select("data").eq("id", nodeId).single();
      const merged = { ...(node?.data ?? {}), ...fields };
      // Save data first (always works)
      await supabase.from("nodes").update({ data: merged }).eq("id", nodeId);
      // Save enrichment status columns (requires migration 0010)
      await supabase.from("nodes").update({ enriched_at: new Date().toISOString(), enrichment_status: "done" }).eq("id", nodeId);

      // Create notification for the workspace
      const summary = Object.keys(fields).slice(0, 3).join(", ");
      await supabase.from("notifications").insert({
        workspace_id: workspaceId,
        type: "agent",
        title: "✦ Record enriched",
        body: `AI filled in: ${summary}${Object.keys(fields).length > 3 ? ` +${Object.keys(fields).length - 3} more` : ""}`,
        metadata: { nodeId, fields_added: Object.keys(fields).length },
      });

      await completeJob(jobId, { fields_added: Object.keys(fields).length, fields }, []);
      return { enriched: true, fields_count: Object.keys(fields).length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(jobId, msg);
      throw err;
    }
  },
);
