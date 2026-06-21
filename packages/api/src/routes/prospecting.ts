import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import * as ubc from "@mondaily/db/ubc";
import { inngest } from "../lib/inngest";
import { startJob, completeJob, failJob } from "../lib/agent-logger";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);

/**
 * Prospecting Agent — searches the web (Tavily) for candidate records of
 * any object type the workspace tracks (people, organizations, assets,
 * investors, suppliers, etc.), has Claude extract structured candidates
 * from the real search results, deduplicates against the workspace graph,
 * and either creates nodes directly or queues them in the Decision Queue
 * for human approval. Every candidate must trace back to a real source
 * URL from the search results — nothing here is invented. Deliberately
 * not scoped to "leads" or "sales" — object_type is caller-supplied so
 * this works for any vertical the workspace uses.
 */

export interface ProspectCandidate {
  name: string;
  object_type: string;
  email: string | null;
  domain: string | null;
  website: string | null;
  linkedin: string | null;
  description: string | null;
  location: string | null;
  source_url: string;
  source_title: string;
  confidence_label: "high" | "medium" | "low";
  reason: string;
}

const runSchema = z.object({
  query: z.string().min(1),
  object_type: z.string().min(1),
  count: z.coerce.number().int().min(1).max(50).default(10),
  destination_list_id: z.string().uuid().optional(),
  require_approval: z.boolean().default(true),
});

export type ProspectingRunInput = z.infer<typeof runSchema>;

export interface ProspectingRunResult {
  created: number;
  existing: number;
  queued_for_review: number;
  added_to_list: number;
  candidates: (ProspectCandidate & { status: "created" | "existing" | "queued_for_review"; node_id?: string; decision_id?: string })[];
  sources: { url: string; title: string }[];
}

async function tavilySearch(query: string, maxResults: number): Promise<{ url: string; title: string; content: string }[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, max_results: maxResults, search_depth: "advanced" }),
    });
    if (!res.ok) return [];
    const json = await res.json() as { results?: { title: string; content: string; url: string }[] };
    return (json.results ?? []).map(r => ({ url: r.url, title: r.title, content: r.content }));
  } catch {
    return [];
  }
}

async function extractCandidates(
  query: string,
  objectType: string,
  count: number,
  results: { url: string; title: string; content: string }[],
): Promise<ProspectCandidate[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || results.length === 0) return [];

  const sourceList = results.map((r, i) => `[${i}] ${r.title}\nURL: ${r.url}\n${r.content}`).join("\n\n");
  const toolSchema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        description: `Up to ${count} distinct candidates of type "${objectType}" found in the sources below.`,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", description: "Only if explicitly present in a source. Never invent one." },
            domain: { type: "string" },
            website: { type: "string" },
            linkedin: { type: "string" },
            description: { type: "string" },
            location: { type: "string" },
            source_index: { type: "number", description: "Index of the source (from the bracketed list) this candidate came from" },
            confidence_label: { type: "string", enum: ["high", "medium", "low"] },
            reason: { type: "string", description: "One sentence: why this matches the query" },
          },
          required: ["name", "source_index", "confidence_label", "reason"],
        },
      },
    },
    required: ["candidates"],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      tools: [{ name: "extract_candidates", description: "Extract distinct, real candidates strictly from the provided sources", input_schema: toolSchema }],
      tool_choice: { type: "tool", name: "extract_candidates" },
      messages: [{
        role: "user",
        content: `Query: "${query}"\nObject type: "${objectType}"\nFind up to ${count} distinct ${objectType} candidates that genuinely match the query, using ONLY the sources below. Every candidate must map to exactly one source_index. Never fabricate an email, domain, or LinkedIn URL — leave fields you can't find as omitted. If fewer than ${count} real, distinct candidates exist in these sources, return fewer.\n\nSources:\n${sourceList}`,
      }],
    }),
  });
  if (!res.ok) return [];
  const data = await res.json() as { content?: { type: string; input?: Record<string, unknown> }[] };
  const toolBlock = data.content?.find(b => b.type === "tool_use");
  const raw = (toolBlock?.input?.candidates as Record<string, unknown>[] | undefined) ?? [];

  const candidates: ProspectCandidate[] = [];
  for (const c of raw) {
    const idx = Number(c.source_index);
    const source = results[idx];
    if (!source || !c.name) continue; // no real source → drop, never fabricate
    candidates.push({
      name: String(c.name),
      object_type: objectType,
      email: (c.email as string) || null,
      domain: (c.domain as string) || null,
      website: (c.website as string) || null,
      linkedin: (c.linkedin as string) || null,
      description: (c.description as string) || null,
      location: (c.location as string) || null,
      source_url: source.url,
      source_title: source.title,
      confidence_label: (["high", "medium", "low"].includes(c.confidence_label as string) ? c.confidence_label : "low") as ProspectCandidate["confidence_label"],
      reason: String(c.reason ?? ""),
    });
  }
  return candidates.slice(0, count);
}

function normalize(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().trim().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

/** Find an existing node in this workspace that matches a candidate by name, email, domain, website, or LinkedIn. */
async function findExistingNode(workspaceId: string, objectType: string, candidate: ProspectCandidate): Promise<string | null> {
  const { data: nodes } = await supabase
    .from("nodes")
    .select("id, data")
    .eq("workspace_id", workspaceId)
    .eq("object_type", objectType)
    .limit(2000);
  if (!nodes?.length) return null;

  const targets = {
    name: normalize(candidate.name),
    email: normalize(candidate.email),
    domain: normalize(candidate.domain),
    website: normalize(candidate.website),
    linkedin: normalize(candidate.linkedin),
  };

  for (const node of nodes) {
    const d = (node.data ?? {}) as Record<string, unknown>;
    const fields = {
      name: normalize((d.name ?? d.company ?? d.full_name ?? d.title) as string | undefined),
      email: normalize(d.email as string | undefined),
      domain: normalize(d.domain as string | undefined),
      website: normalize(d.website as string | undefined),
      linkedin: normalize(d.linkedin as string | undefined),
    };
    if (targets.email && fields.email && targets.email === fields.email) return node.id;
    if (targets.domain && fields.domain && targets.domain === fields.domain) return node.id;
    if (targets.website && fields.website && targets.website === fields.website) return node.id;
    if (targets.linkedin && fields.linkedin && targets.linkedin === fields.linkedin) return node.id;
    if (targets.name && fields.name && targets.name === fields.name) return node.id;
  }
  return null;
}

export function objectTypeToVertical(objectType: string): "sales" | "realestate" | "hr" | "finance" | "investments" | "tasks" | "shared" {
  const t = objectType.toLowerCase();
  if (t.includes("invest") || t.includes("fund") || t.includes("portfolio")) return "investments";
  if (t.includes("property") || t.includes("asset") || t.includes("supplier")) return "realestate";
  if (t.includes("employee") || t.includes("candidate") || t.includes("hire")) return "hr";
  if (t.includes("invoice") || t.includes("expense")) return "finance";
  return "shared";
}

/**
 * Core prospecting run — used by both POST /prospecting/run and the
 * discover_web_prospects Ask Mondaily tool, so both surfaces share one
 * implementation (no duplicated search/extract/dedupe logic).
 */
export async function runProspecting(
  workspaceId: string,
  userId: string,
  input: ProspectingRunInput,
): Promise<ProspectingRunResult> {
  const jobId = await startJob({
    workspace_id: workspaceId,
    agent_name: "prospecting",
    trigger_type: "manual",
    input: { query: input.query, object_type: input.object_type, count: input.count },
  });

  try {
    const searchResults = await tavilySearch(`${input.query} ${input.object_type}`, Math.min(input.count * 2, 20));
    const candidates = await extractCandidates(input.query, input.object_type, input.count, searchResults);

    const result: ProspectingRunResult = {
      created: 0, existing: 0, queued_for_review: 0, added_to_list: 0,
      candidates: [], sources: searchResults.map(r => ({ url: r.url, title: r.title })),
    };

    for (const candidate of candidates) {
      const existingNodeId = await findExistingNode(workspaceId, input.object_type, candidate);
      if (existingNodeId) {
        result.existing++;
        result.candidates.push({ ...candidate, status: "existing", node_id: existingNodeId });
        continue;
      }

      if (input.require_approval) {
        const { data: decision } = await supabase.from("decision_queue").insert({
          workspace_id: workspaceId,
          source_type: "prospecting_candidate",
          source_id: null,
          agent_name: "prospecting",
          title: `New ${input.object_type}: ${candidate.name}`,
          summary: candidate.description ?? candidate.reason,
          recommended_action: `Add "${candidate.name}" to the workspace graph`,
          risk_level: "low",
          evidence: [{
            type: "prospecting_candidate",
            title: candidate.name,
            match_reason: candidate.reason,
            candidate,
            destination_list_id: input.destination_list_id ?? null,
          }],
        }).select("id").single();
        result.queued_for_review++;
        result.candidates.push({ ...candidate, status: "queued_for_review", decision_id: decision?.id });
      } else {
        const node = await ubc.createNode({
          workspace_id: workspaceId,
          vertical: objectTypeToVertical(input.object_type),
          object_type: input.object_type,
          created_by: `agent:prospecting`,
          data: {
            name: candidate.name,
            email: candidate.email ?? undefined,
            domain: candidate.domain ?? undefined,
            website: candidate.website ?? undefined,
            linkedin: candidate.linkedin ?? undefined,
            description: candidate.description ?? undefined,
            location: candidate.location ?? undefined,
            source_url: candidate.source_url,
            source_title: candidate.source_title,
            confidence_label: candidate.confidence_label,
          },
        });
        await ubc.logActivity(node.id!, workspaceId, "ai_agent", "prospecting", "created", undefined, `Found via web search: ${candidate.reason}`);
        inngest.send({
          name: "crm/record.created",
          data: { workspaceId, nodeId: node.id!, objectType: input.object_type, vertical: objectTypeToVertical(input.object_type) },
        }).catch(() => {});

        if (input.destination_list_id) {
          const { count } = await supabase.from("list_entries").select("*", { count: "exact", head: true }).eq("list_id", input.destination_list_id);
          await supabase.from("list_entries").upsert({ list_id: input.destination_list_id, node_id: node.id, position: (count ?? 0) + 1 });
          result.added_to_list++;
        }

        result.created++;
        result.candidates.push({ ...candidate, status: "created", node_id: node.id });
      }
    }

    await completeJob(jobId, {
      created: result.created, existing: result.existing,
      queued_for_review: result.queued_for_review, added_to_list: result.added_to_list,
    }, []);

    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(jobId, msg);
    throw err;
  }
}

router.post("/run", zValidator("json", runSchema), async (c) => {
  const input = c.req.valid("json");
  try {
    const result = await runProspecting(c.get("workspaceId"), c.get("userId"), input);
    return c.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

export { router as prospectingRouter };
