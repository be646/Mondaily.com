import { supabase } from "@mondaily/db/client";
import { aiGatewayToolUse } from "./ai-gateway";
import { isEmbeddingsEnabled, embedOne } from "./embeddings";
import { learnedGuidanceFor } from "./autonomy";

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
  const fallback: ReasonedDecision = {
    title: f.defaultTitle, summary: f.facts, recommended_action: f.defaultAction,
    rationale: "", risk_level: f.defaultRisk, confidence: "medium", reasoned: false,
  };
  try {
    // 1. RAG — related records so the agent reasons WITH the surrounding graph.
    let context = "";
    if (isEmbeddingsEnabled()) {
      const qv = await embedOne(`${f.recordName} ${f.facts}`);
      if (qv) {
        const { data: matches } = await supabase.rpc("match_node_embeddings", { ws: workspaceId, query_embedding: qv as unknown as string, k: 6 });
        const ids = ((matches ?? []) as { node_id: string }[]).map((m) => m.node_id).filter((id) => id !== f.sourceId).slice(0, 4);
        if (ids.length) {
          const { data: nodes } = await supabase.from("nodes").select("object_type, data").eq("workspace_id", workspaceId).in("id", ids);
          context = ((nodes ?? []) as { object_type: string; data: Record<string, unknown> }[])
            .map((n) => `- ${n.object_type}: ${String((n.data as { name?: string })?.name ?? "record")}`).join("\n");
        }
      }
    }
    // 2. Learned preferences for THIS agent.
    const guidance = await learnedGuidanceFor(workspaceId, f.agentName);
    // 3. Reason.
    const out = await aiGatewayToolUse({
      system:
        `You are the ${f.agentName} agent inside a business operating system. Given a finding and the related workspace context, REASON about the single best next step for the operator. Output: a sharp title, a concise summary, a SPECIFIC recommended_action (name who/what/amount from the facts — never generic like "reassign or reschedule"), a one-sentence rationale (why it matters + why this action), a risk_level, and your confidence. Ground everything strictly in the given facts and context — never invent names, numbers, or records.` +
        (guidance ? `\n\n${guidance}` : ""),
      prompt: `Finding: ${f.facts}\nSubject: ${f.recordName}\n${context ? `Related records:\n${context}` : "No related records found."}\n\nProduce the reasoned recommendation.`,
      toolName: "recommend",
      toolDescription: "The reasoned recommendation for this finding",
      toolSchema: {
        type: "object",
        properties: {
          title: { type: "string" }, summary: { type: "string" }, recommended_action: { type: "string" },
          rationale: { type: "string" },
          risk_level: { type: "string", enum: ["low", "medium", "high"] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["title", "recommended_action", "risk_level"],
      },
      maxTokens: 600, workspaceId, feature: `agent_reasoning_${f.agentName}`, taskClass: "reasoning",
    });
    const r = out as Record<string, unknown>;
    if (!r?.recommended_action) return fallback;
    const risk = String(r.risk_level);
    const conf = String(r.confidence);
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
