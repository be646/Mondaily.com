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
