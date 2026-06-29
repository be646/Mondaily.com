import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

/**
 * Team Oversight — manager-facing "who did what" timeline. RBAC: owner/admin only
 * (the manager-equivalent roles; this codebase has no separate "manager" role).
 * Actor names/avatars are resolved server-side from workspace_members, which already
 * stores the Clerk-resolved name + avatar — so no per-request Clerk calls and no raw
 * `user_2N…` ids ever reach the client.
 */
router.get("/oversight", requireAuth, requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const limit = Math.min(Number(c.req.query("limit")) || 150, 300);
  const actorFilter = c.req.query("actor"); // optional: filter to one actor_id

  let q = supabase
    .from("activities")
    .select("id, actor_type, actor_id, action, ai_summary, node_id, created_at, nodes(object_type, data)")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (actorFilter) q = q.eq("actor_id", actorFilter);
  const { data: acts } = await q;

  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, name, email, avatar_url, role")
    .eq("workspace_id", ws);
  const byUser = new Map((members ?? []).map(m => [m.user_id as string, m]));

  const rows = (acts ?? []).map((a) => {
    const m = a.actor_type === "human" ? byUser.get(a.actor_id as string) : undefined;
    const node = (a as { nodes?: { object_type?: string; data?: Record<string, unknown> } | null }).nodes;
    const nodeName = (node?.data?.name ?? node?.data?.title) as string | undefined;
    return {
      id: a.id,
      actor_type: a.actor_type,                                   // "human" | "agent" | "system"
      actor_id: a.actor_id,                                       // agent slug (frontend maps) or user id
      actor_name: m?.name || m?.email || null,                    // resolved human name (null → frontend labels)
      actor_avatar: (m as { avatar_url?: string } | undefined)?.avatar_url ?? null,
      action: a.action,
      ai_summary: a.ai_summary ?? null,
      object: node?.object_type ? { type: node.object_type, name: nodeName ?? null } : null,
      created_at: a.created_at,
    };
  });

  // Per-actor roll-up for the header (real counts).
  const tally: Record<string, { actor_id: string; actor_type: string; actor_name: string | null; actor_avatar: string | null; count: number }> = {};
  for (const r of rows) {
    const key = String(r.actor_id ?? r.actor_type);
    if (!tally[key]) tally[key] = { actor_id: String(r.actor_id ?? ""), actor_type: r.actor_type, actor_name: r.actor_name, actor_avatar: r.actor_avatar, count: 0 };
    tally[key]!.count++;
  }
  return c.json({ activity: rows, actors: Object.values(tally).sort((a, b) => b.count - a.count) });
});

// Timeline for a specific node
router.get("/node/:nodeId", requireAuth, async (c) => {
  const { data } = await supabase
    .from("activities")
    .select("*")
    .eq("node_id", c.req.param("nodeId"))
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false })
    .limit(50);
  return c.json(data ?? []);
});

// All activities for workspace (feed)
router.get("/", requireAuth, async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const { data } = await supabase
    .from("activities")
    .select("*, nodes(id, object_type, data)")
    .eq("workspace_id", c.get("workspaceId"))
    .order("created_at", { ascending: false })
    .limit(limit);
  return c.json(data ?? []);
});

export { router as activitiesRouter };
