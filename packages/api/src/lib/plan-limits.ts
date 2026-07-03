import { getEntitlement } from "./entitlements";

/**
 * Per-tier limits — the source of truth for "accounts align with account type". -1 = unlimited.
 * Matches apps/app/src/lib/plans.ts (Scout: 1 agent / 3 automations; Operator+ unlimited).
 */
export interface PlanLimits { maxAutomations: number; maxAgents: number }
const LIMITS: Record<string, PlanLimits> = {
  scout: { maxAutomations: 3, maxAgents: 1 },
  operator: { maxAutomations: -1, maxAgents: -1 },
  command: { maxAutomations: -1, maxAgents: -1 },
  sovereign: { maxAutomations: -1, maxAgents: -1 },
};

function normalizeTier(raw?: string | null): string {
  switch ((raw ?? "").toLowerCase()) {
    case "operator": case "business": case "trial": case "pro": return "operator";
    case "command": return "command";
    case "sovereign": case "enterprise": return "sovereign";
    default: return "scout";
  }
}

export function planLimits(tier?: string | null): PlanLimits {
  return LIMITS[normalizeTier(tier)] ?? LIMITS.scout!;
}

/** Resolve a workspace's tier — delegates to the single entitlement resolver. */
export async function workspaceTier(workspaceId: string): Promise<string> {
  return (await getEntitlement(workspaceId)).tier;
}
