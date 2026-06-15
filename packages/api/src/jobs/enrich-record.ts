import { inngest, type Events } from "../lib/inngest";
import { startJob, completeJob, failJob, logStep } from "../lib/agent-logger";
import { supabase } from "@mondaily/db/client";

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

async function callClaude(prompt: string, toolName: string, toolSchema: object): Promise<Record<string, unknown>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return {};
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      tools: [{ name: toolName, description: "Extract enrichment fields", input_schema: toolSchema }],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return {};
  const data = await res.json() as { content?: { type: string; input?: Record<string, unknown> }[] };
  const toolBlock = data.content?.find(b => b.type === "tool_use");
  const fields = toolBlock?.input ?? {};
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v != null && v !== ""));
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
        const query = email
          ? `${email} linkedin job title company`
          : `${name} linkedin job title company professional`;

        await logStep(jobId, { step: "tavily_search", query });
        const webContext = await tavilySearch(query);

        await logStep(jobId, { step: "claude_enrich", type: "person" });
        fields = await callClaude(
          `Enrich this person. Name: "${name}", Email: "${email}"\n${webContext ? `Web context:\n${webContext}` : ""}`,
          "enrich_person",
          {
            type: "object",
            properties: {
              company:   { type: "string" },
              job_title: { type: "string" },
              linkedin:  { type: "string" },
              location:  { type: "string" },
              twitter:   { type: "string" },
              bio:       { type: "string" },
            },
          },
        );
      } else {
        const name = (recordData.name ?? recordData.Name ?? recordData.company_name ?? "") as string;
        const domain = (recordData.domain ?? recordData.website ?? "") as string;
        const query = `${name} ${domain} company funding employees revenue industry`;

        await logStep(jobId, { step: "tavily_search", query });
        const webContext = await tavilySearch(query);

        await logStep(jobId, { step: "claude_enrich", type: "company" });
        fields = await callClaude(
          `Enrich this company. Name: "${name}", Domain: "${domain}"\n${webContext ? `Web context:\n${webContext}` : ""}`,
          "enrich_company",
          {
            type: "object",
            properties: {
              description:    { type: "string" },
              country:        { type: "string" },
              employee_range: { type: "string" },
              arr:            { type: "number" },
              funding_raised: { type: "number" },
              website:        { type: "string" },
              industry:       { type: "string" },
              founded_year:   { type: "number" },
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
