import { supabase } from "@mondaily/db/client";

// How much agents may self-approve WITHOUT a human. Stored on workspaces.settings.agent_autonomy.
//   manual     — everything waits for approval (default; the historical behaviour).
//   assisted   — LOW-risk decisions auto-approve + execute; medium/high still queue.
//   autonomous — LOW + MEDIUM auto-approve + execute; HIGH always queues.
// HIGH-risk NEVER auto-runs at any level. Every auto-approval is logged (resolved_by='autonomy').
export type AutonomyLevel = "manual" | "assisted" | "autonomous";

export async function readAutonomy(workspaceId: string): Promise<AutonomyLevel> {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const v = (data?.settings as { agent_autonomy?: string } | null)?.agent_autonomy;
  return v === "assisted" || v === "autonomous" ? v : "manual";
}

export function autoApproves(level: AutonomyLevel, risk: string): boolean {
  if (risk === "high") return false;
  if (level === "assisted") return risk === "low";
  if (level === "autonomous") return risk === "low" || risk === "medium";
  return false;
}

// ── Learning loop: what agents have LEARNED you want, from your real approve/reject history ──
// Deterministic (no AI): aggregates decisions YOU resolved by hand — autonomy/learned auto-actions
// are excluded so this is a true human-preference signal, not a feedback echo of the machine.
export interface LearnedPreference {
  agent_name: string;
  source_type: string;
  approved: number;
  rejected: number;
  resolved: number;          // human-resolved total (approved + rejected)
  approval_rate: number | null;   // null until there's a meaningful sample
  verdict: "favored" | "neutral" | "disfavored" | "learning";
}

const LEARN_MIN_SAMPLE = 6;   // need at least this many human decisions before we claim a pattern
const FAVOR_AT = 80;          // ≥80% approved → favored
const DISFAVOR_AT = 20;       // ≤20% approved → disfavored

export function verdictFor(approved: number, rejected: number): LearnedPreference["verdict"] {
  const resolved = approved + rejected;
  if (resolved < LEARN_MIN_SAMPLE) return "learning";
  const rate = (approved / resolved) * 100;
  if (rate >= FAVOR_AT) return "favored";
  if (rate <= DISFAVOR_AT) return "disfavored";
  return "neutral";
}

/**
 * ACTUATION half of the learning loop: turn the learned preferences into a short natural-language
 * instruction to inject into an AI agent's generation prompt, so it proposes MORE of what you
 * approve and LESS of what you reject. Returns "" when there's no meaningful signal yet (never
 * fabricates a preference). Optionally scoped to one agent.
 */
export async function learnedGuidanceFor(workspaceId: string, agentName?: string): Promise<string> {
  const prefs = (await getLearnedPreferences(workspaceId))
    .filter((p) => !agentName || p.agent_name === agentName)
    .filter((p) => p.verdict === "favored" || p.verdict === "disfavored");
  const favored = prefs.filter((p) => p.verdict === "favored").map((p) => `${p.agent_name}/${p.source_type}`);
  const disfavored = prefs.filter((p) => p.verdict === "disfavored").map((p) => `${p.agent_name}/${p.source_type}`);
  const parts: string[] = [];
  if (favored.length) parts.push(`The user consistently APPROVES these kinds of proposals — keep producing them: ${favored.join(", ")}.`);
  if (disfavored.length) parts.push(`The user consistently REJECTS these — avoid proposing them unless clearly warranted: ${disfavored.join(", ")}.`);

  // FEW-SHOT: concrete recent decisions the user actually approved / rejected for this agent, so the
  // model learns the specific style + threshold — not just the category. Bounded + fail-soft.
  const examples = await learnedExamplesFor(workspaceId, agentName).catch(() => "");

  if (!parts.length && !examples) return "";
  const preferenceLine = parts.length ? `Learned from this user's own approve/reject history: ${parts.join(" ")}` : "";
  return [preferenceLine, examples].filter(Boolean).join("\n");
}

/**
 * Pulls a few real, recently HUMAN-resolved decisions for this agent and formats them as approve/
 * reject examples — few-shot signal the reasoning model can pattern-match against. Human resolutions
 * only (excludes autonomy/learned auto-approvals). Returns "" when there's nothing to learn from yet.
 */
export async function learnedExamplesFor(workspaceId: string, agentName?: string): Promise<string> {
  let q = supabase
    .from("decision_queue")
    .select("title, recommended_action, status, resolved_by, agent_name, updated_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["approved", "rejected", "executed", "completed"])
    .order("updated_at", { ascending: false })
    .limit(40);
  if (agentName) q = q.eq("agent_name", agentName);
  const { data } = await q;
  const rows = (data ?? []).filter((d) => {
    const by = String((d as { resolved_by?: string }).resolved_by ?? "");
    return by !== "autonomy" && by !== "learned_policy";
  });
  const approved: string[] = [], rejected: string[] = [];
  for (const d of rows) {
    const status = String((d as { status?: string }).status ?? "");
    const title = String((d as { title?: string }).title ?? "").trim();
    if (!title) continue;
    const line = `"${title.slice(0, 90)}"`;
    if (status === "rejected") { if (rejected.length < 3) rejected.push(line); }
    else { if (approved.length < 3) approved.push(line); }
    if (approved.length >= 3 && rejected.length >= 3) break;
  }
  if (!approved.length && !rejected.length) return "";
  const lines: string[] = ["Recent examples of this user's own calls (match the approved style, avoid the rejected pattern):"];
  if (approved.length) lines.push(`APPROVED: ${approved.join("; ")}.`);
  if (rejected.length) lines.push(`REJECTED: ${rejected.join("; ")}.`);
  return lines.join(" ");
}

export async function getLearnedPreferences(workspaceId: string): Promise<LearnedPreference[]> {
  // Only HUMAN resolutions count as preference signal: exclude resolved_by 'autonomy' / 'learned'.
  const { data } = await supabase
    .from("decision_queue")
    .select("agent_name, source_type, status, resolved_by")
    .eq("workspace_id", workspaceId)
    .in("status", ["approved", "rejected", "executed", "completed"]);
  const rows = (data ?? []).filter((d) => {
    const by = String((d as { resolved_by?: string }).resolved_by ?? "");
    return by !== "autonomy" && by !== "learned_policy";
  });
  const agg = new Map<string, { agent_name: string; source_type: string; approved: number; rejected: number }>();
  for (const d of rows) {
    const agent_name = String((d as { agent_name?: string }).agent_name ?? "agent");
    const source_type = String((d as { source_type?: string }).source_type ?? "other");
    const status = String((d as { status?: string }).status ?? "");
    const key = `${agent_name}::${source_type}`;
    const e = agg.get(key) ?? { agent_name, source_type, approved: 0, rejected: 0 };
    if (status === "rejected") e.rejected++;
    else e.approved++; // approved / executed / completed all read as "you wanted this"
    agg.set(key, e);
  }
  return [...agg.values()]
    .map((e) => {
      const resolved = e.approved + e.rejected;
      return {
        ...e,
        resolved,
        approval_rate: resolved ? Math.round((e.approved / resolved) * 100) : null,
        verdict: verdictFor(e.approved, e.rejected),
      };
    })
    .sort((a, b) => b.resolved - a.resolved);
}

type DecisionRow = {
  id: string;
  risk_level?: string | null;
  title?: string | null;
  agent_name?: string | null;
  source_id?: string | null;
} & Record<string, unknown>;

/**
 * Apply the workspace's autonomy dial to a freshly-inserted decision row. This is the SINGLE
 * place agents must call so autonomy works no matter WHERE a decision is created (HTTP route,
 * cron runner, vertical agent, workflow engine, discovery/prospecting). Without this, only
 * decisions created through POST /decisions were ever auto-approved.
 *
 * Returns true when the decision was auto-approved (and its action executed). No-op + false when
 * autonomy is manual, the risk band is out of range, or the row is missing an id/risk_level.
 * Fully audited: writes an `activities` row (action=decision_auto_approved, actor_type=agent).
 */
export async function maybeAutoApprove(workspaceId: string, decision: DecisionRow | null | undefined): Promise<boolean> {
  if (!decision?.id) return false;
  const level = await readAutonomy(workspaceId);
  if (!autoApproves(level, String(decision.risk_level ?? "low"))) return false;

  // executeApprovedAction lives in routes/decisions.ts alongside the HTTP handlers; import it
  // lazily to avoid a static import cycle (routes → lib → routes).
  try {
    const { executeApprovedAction } = await import("../routes/decisions");
    await executeApprovedAction(workspaceId, decision);
  } catch (e) { console.error("[autonomy] execute failed:", e); }

  await supabase.from("decision_queue")
    .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: "autonomy" })
    .eq("workspace_id", workspaceId).eq("id", decision.id);

  await supabase.from("activities").insert({
    node_id: decision.source_id ?? null, workspace_id: workspaceId, actor_type: "agent",
    actor_id: String(decision.agent_name ?? "agent"), action: "decision_auto_approved",
    diff: { decision_id: decision.id, title: decision.title, risk: decision.risk_level, autonomy: level },
  }).then(() => {}, () => {});

  return true;
}
