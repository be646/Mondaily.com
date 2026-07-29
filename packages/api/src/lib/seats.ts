import { supabase } from "@mondaily/db/client";
import { PLAN_TIERS } from "@mondaily/shared/pricing";
import { getEntitlement } from "./entitlements";

/**
 * Seat capacity — the ONE place the plan's seat cap is enforced.
 *
 * The catalog has always defined seats per tier (Scout 1 / Operator 5 / Command 20 / Sovereign 999)
 * and the API reported them, but NOTHING enforced them: POST /invites, POST /invites/link and
 * POST /invites/accept all wrote to workspace_members with no capacity check. A Scout workspace
 * ($0, one seat) could mint a shareable link and onboard an unlimited number of people.
 *
 * Counted against ACCEPTED members plus still-open invites, so a burst of invites can't collectively
 * overshoot the cap even though each was under it when sent.
 */
export interface SeatUsage { limit: number; members: number; pendingInvites: number; used: number; remaining: number }

export async function seatUsage(workspaceId: string): Promise<SeatUsage> {
  const [{ tier }, members, invites] = await Promise.all([
    getEntitlement(workspaceId),   // resolved entitlement — never re-derive the tier locally
    supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("workspace_invites").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).is("accepted_at", null).gt("expires_at", new Date().toISOString()),
  ]);
  const limit = PLAN_TIERS[tier].seats;
  const memberCount = members.count ?? 0;
  const pendingInvites = invites.count ?? 0;
  const used = memberCount + pendingInvites;
  return { limit, members: memberCount, pendingInvites, used, remaining: Math.max(0, limit - used) };
}

/** Message shown when a workspace is at capacity — states the real numbers, never a vague refusal. */
export function seatLimitMessage(u: SeatUsage): string {
  const detail = u.pendingInvites > 0
    ? `${u.members} member${u.members === 1 ? "" : "s"} and ${u.pendingInvites} pending invite${u.pendingInvites === 1 ? "" : "s"}`
    : `${u.members} member${u.members === 1 ? "" : "s"}`;
  return `Your plan includes ${u.limit} seat${u.limit === 1 ? "" : "s"} and you already have ${detail}. Upgrade your plan to add more people.`;
}
