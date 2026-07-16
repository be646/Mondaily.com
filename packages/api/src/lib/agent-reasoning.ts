import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse, aiGatewayAgent } from "./ai-gateway";
import { isEmbeddingsEnabled, embedOne } from "./embeddings";
import { learnedGuidanceFor } from "./autonomy";
import { getEntitlement } from "./entitlements";

// Reasoning is a plan-differentiated capability with a per-hour, per-workspace budget so cost scales
// with the tier — higher plans let agents reason on more findings. Toggleable off per workspace
// (settings.agent_reasoning === false). Both the config and the usage are cached in-process.
const HOURLY_CAP_BY_TIER: Record<string, number> = { scout: 12, operator: 80, command: 200, sovereign: 600 };
const cfgCache = new Map<string, { enabled: boolean; cap: number; ts: number }>();
const usage = new Map<string, { hour: number; used: number }>();

async function reasoningConfig(workspaceId: string): Promise<{ enabled: boolean; cap: number }> {
  const c = cfgCache.get(workspaceId);
  if (c && Date.now() - c.ts < 60_000) return { enabled: c.enabled, cap: c.cap };
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const enabled = ((data?.settings as { agent_reasoning?: boolean } | null)?.agent_reasoning) !== false; // default ON
  let cap = HOURLY_CAP_BY_TIER.operator ?? 80;
  try { cap = HOURLY_CAP_BY_TIER[(await getEntitlement(workspaceId)).tier] ?? cap; } catch { /* keep default */ }
  cfgCache.set(workspaceId, { enabled, cap, ts: Date.now() });
  return { enabled, cap };
}

// Consume one unit of the hourly budget; false when the workspace is out (→ fall back to rule-based).
function consumeBudget(workspaceId: string, cap: number): boolean {
  const hour = Math.floor(Date.now() / 3_600_000);
  const u = usage.get(workspaceId);
  if (!u || u.hour !== hour) { usage.set(workspaceId, { hour, used: 1 }); return true; }
  if (u.used >= cap) return false;
  u.used++; return true;
}

/**
 * The reasoning layer that turns any agent's raw RULE-BASED finding into a REASONED recommendation:
 * it pulls semantically-related workspace context (RAG, when embeddings are on), conditions on the
 * user's own approve/reject history (learning loop), and asks the reasoning model for a sharp title,
 * a SPECIFIC next action, a one-line rationale (why), a refined risk level and a confidence.
 *
 * Fail-soft by design: on any error, missing credits, or embeddings-off it returns the caller's
 * rule-based defaults (reasoned:false), so agents never regress. Callers should reason SELECTIVELY
 * (e.g. only medium/high-risk findings, capped per run) to keep cost bounded.
 */
export interface RawFinding {
  agentName: string;
  recordName: string;                                   // subject (task title, deal name, …)
  facts: string;                                        // objective facts the rule found
  defaultTitle: string;
  defaultAction: string;
  defaultRisk: "low" | "medium" | "high";
  sourceId?: string | null;                             // node id, to exclude self from RAG + seed it
}
export interface ReasonedDecision {
  title: string;
  summary: string;
  recommended_action: string;
  rationale: string;                                    // WHY — empty when not reasoned
  risk_level: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  reasoned: boolean;
}

export async function reasonAboutFinding(workspaceId: string, f: RawFinding): Promise<ReasonedDecision> {
  // Smartness ladder: HIGH-risk findings get the full tool-chaining ReAct investigation (it can
  // search + open related records before deciding); medium-risk get RAG + self-reflection below.
  if (f.defaultRisk === "high") return reactDeepReason(workspaceId, f);
  const fallback: ReasonedDecision = {
    title: f.defaultTitle, summary: f.facts, recommended_action: f.defaultAction,
    rationale: "", risk_level: f.defaultRisk, confidence: "medium", reasoned: false,
  };
  try {
    // Plan gate + budget: reasoning off for this workspace, or over its hourly tier budget → the
    // agent stays on the cheap rule-based path (no regression, just no extra AI spend).
    const cfg = await reasoningConfig(workspaceId);
    if (!cfg.enabled || !consumeBudget(workspaceId, cfg.cap)) return fallback;
    const guidance = await learnedGuidanceFor(workspaceId, f.agentName);

    // RAG — pull the k most-related records so the agent reasons WITH the surrounding graph.
    const gatherContext = async (k: number): Promise<string> => {
      if (!isEmbeddingsEnabled()) return "";
      const qv = await embedOne(`${f.recordName} ${f.facts}`);
      if (!qv) return "";
      const { data: matches } = await supabase.rpc("match_node_embeddings", { ws: workspaceId, query_embedding: qv as unknown as string, k });
      const ids = ((matches ?? []) as { node_id: string }[]).map((m) => m.node_id).filter((id) => id !== f.sourceId).slice(0, k - 2);
      if (!ids.length) return "";
      const { data: nodes } = await supabase.from("nodes").select("object_type, data").eq("workspace_id", workspaceId).in("id", ids);
      return ((nodes ?? []) as { object_type: string; data: Record<string, unknown> }[])
        .map((n) => `- ${n.object_type}: ${String((n.data as { name?: string })?.name ?? "record")}`).join("\n");
    };

    const toolSchema = {
      type: "object" as const,
      properties: {
        title: { type: "string" }, summary: { type: "string" }, recommended_action: { type: "string" },
        rationale: { type: "string" },
        risk_level: { type: "string", enum: ["low", "medium", "high"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title", "recommended_action", "risk_level"],
    };

    const reason = async (context: string, reflect: boolean): Promise<ReasonedDecision | null> => {
      const out = await aiGatewayToolUse({
        system:
          `You are the ${f.agentName} agent inside a business operating system. Given a finding and the related workspace context, REASON about the single best next step for the operator. Output: a sharp title, a concise summary, a SPECIFIC recommended_action (name who/what/amount from the facts — never generic like "reassign or reschedule"), a one-sentence rationale (why it matters + why this action), a risk_level, and your confidence. Ground everything strictly in the given facts and context — never invent names, numbers, or records.` +
          (reflect ? ` Your first attempt was LOW-CONFIDENCE. Reconsider more carefully using the broader context now provided; only keep low confidence if the data genuinely doesn't support a clear action.` : "") +
          (guidance ? `\n\n${guidance}` : ""),
        prompt: `Finding: ${f.facts}\nSubject: ${f.recordName}\n${context ? `Related records:\n${context}` : "No related records found."}\n\nProduce the reasoned recommendation.`,
        toolName: "recommend", toolDescription: "The reasoned recommendation for this finding",
        toolSchema, maxTokens: 600, workspaceId, feature: `agent_reasoning_${f.agentName}`, taskClass: "reasoning",
      });
      const r = out as Record<string, unknown>;
      if (!r?.recommended_action) return null;
      const risk = String(r.risk_level); const conf = String(r.confidence);
      return {
        title: String(r.title || f.defaultTitle).slice(0, 160),
        summary: String(r.summary || f.facts).slice(0, 400),
        recommended_action: String(r.recommended_action).slice(0, 240),
        rationale: String(r.rationale ?? "").slice(0, 300),
        risk_level: (["low", "medium", "high"].includes(risk) ? risk : f.defaultRisk) as "low" | "medium" | "high",
        confidence: (["low", "medium", "high"].includes(conf) ? conf : "medium") as "low" | "medium" | "high",
        reasoned: true,
      };
    };

    // First pass. Then a bounded SELF-REFLECTION step (ReAct-style, capped at one extra pass): if the
    // agent was low-confidence, gather broader context and reason again — genuine multi-step, only
    // when it's actually warranted so cost stays bounded.
    let result = await reason(await gatherContext(6), false);
    if (result && result.confidence === "low") {
      const deeper = await reason(await gatherContext(14), true);
      if (deeper) result = deeper;
    }
    return result ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Deep, tool-chaining ReAct reasoner for the HARDEST (high-risk) findings. Unlike reasonAboutFinding
 * (which reasons over pre-fetched context), this lets the model DECIDE what to investigate: it can
 * search the workspace by meaning and open related records over a few rounds, then finalize a
 * grounded recommendation. Runs on the shared aiGatewayAgent tool loop. Same budget/toggle gate and
 * fail-soft contract as reasonAboutFinding.
 */
export async function reactDeepReason(workspaceId: string, f: RawFinding): Promise<ReasonedDecision> {
  const fallback: ReasonedDecision = {
    title: f.defaultTitle, summary: f.facts, recommended_action: f.defaultAction,
    rationale: "", risk_level: f.defaultRisk, confidence: "medium", reasoned: false,
  };
  const cfg = await reasoningConfig(workspaceId);
  if (!cfg.enabled || !consumeBudget(workspaceId, cfg.cap)) return fallback;

  let captured: Record<string, unknown> | null = null;
  const tools = [
    { name: "search_records", description: "Search the workspace for records related to a query, BY MEANING. Returns matching record names + types.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "get_record", description: "Fetch the full detail (all fields) of a workspace record by its name.", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    { name: "finalize", description: "Record your FINAL reasoned recommendation once you have enough evidence. Call this exactly once.", input_schema: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, recommended_action: { type: "string" }, rationale: { type: "string" }, risk_level: { type: "string", enum: ["low", "medium", "high"] }, confidence: { type: "string", enum: ["low", "medium", "high"] } }, required: ["title", "recommended_action", "risk_level"] } },
  ];
  const onToolCall = async (name: string, input: Record<string, unknown>): Promise<string> => {
    try {
      if (name === "search_records") {
        if (!isEmbeddingsEnabled()) return "Semantic search is unavailable.";
        const qv = await embedOne(String(input.query ?? ""));
        if (!qv) return "No results.";
        const { data: matches } = await supabase.rpc("match_node_embeddings", { ws: workspaceId, query_embedding: qv as unknown as string, k: 8 });
        const ids = ((matches ?? []) as { node_id: string }[]).map((m) => m.node_id).slice(0, 8);
        if (!ids.length) return "No matching records.";
        const { data: nodes } = await supabase.from("nodes").select("object_type, data").eq("workspace_id", workspaceId).in("id", ids);
        return ((nodes ?? []) as { object_type: string; data: Record<string, unknown> }[]).map((n) => `- ${n.object_type}: ${String((n.data as { name?: string })?.name ?? "record")}`).join("\n") || "No matching records.";
      }
      if (name === "get_record") {
        const { data: nodes } = await supabase.from("nodes").select("object_type, data").eq("workspace_id", workspaceId).ilike("data->>name", `%${String(input.name ?? "")}%`).limit(1);
        const n = ((nodes ?? []) as { object_type: string; data: Record<string, unknown> }[])[0];
        return n ? `${n.object_type}: ${JSON.stringify(n.data).slice(0, 700)}` : "Record not found.";
      }
      if (name === "finalize") { captured = input; return "Recommendation recorded."; }
      return "Unknown tool.";
    } catch { return "Tool error."; }
  };

  try {
    const guidance = await learnedGuidanceFor(workspaceId, f.agentName);
    await aiGatewayAgent({
      system:
        `You are the ${f.agentName} agent in a business operating system, handling a HIGH-RISK finding. INVESTIGATE before deciding: use search_records to find related records by meaning and get_record to read their detail (2–3 tool calls is usually enough — don't over-investigate). Then call finalize ONCE with: a sharp title, a SPECIFIC recommended_action (name the who/what/amount from the data — never generic like "reassign or reschedule"), a one-sentence rationale, a risk_level, and your confidence. Ground everything strictly in the tool results and the given facts — never invent names, numbers, or records.` +
        (guidance ? `\n\n${guidance}` : ""),
      tools,
      messages: [{ role: "user", content: `Finding: ${f.facts}\nSubject: ${f.recordName}\n\nInvestigate, then finalize your recommendation.` }],
      onToolCall, maxRounds: 4, maxTokens: 1000, workspaceId, feature: `agent_react_${f.agentName}`, taskClass: "reasoning",
    });
    const r = captured as Record<string, unknown> | null;
    if (!r?.recommended_action) return fallback;
    const risk = String(r.risk_level); const conf = String(r.confidence);
    return {
      title: String(r.title || f.defaultTitle).slice(0, 160),
      summary: String(r.summary || f.facts).slice(0, 400),
      recommended_action: String(r.recommended_action).slice(0, 240),
      rationale: String(r.rationale ?? "").slice(0, 300),
      risk_level: (["low", "medium", "high"].includes(risk) ? risk : f.defaultRisk) as "low" | "medium" | "high",
      confidence: (["low", "medium", "high"].includes(conf) ? conf : "medium") as "low" | "medium" | "high",
      reasoned: true,
    };
  } catch {
    return fallback;
  }
}
