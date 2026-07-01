import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { verifiedPowUserIds } from "../lib/pow-claims";

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

/**
 * ABI Operator Matrix — per-operator behavioral telemetry for the Team Oversight dashboard.
 * Admin-only. Everything is REAL, joined server-side:
 *   • operators        ← workspace_members
 *   • tokens / runs    ← ai_usage grouped by user_id (the per-operator mirror of ai_credits_ledger)
 *   • last task / time ← most recent activities row per actor
 *   • has_session      ← a live (non-revoked, unexpired) auth_refresh_token = a verified native client claim
 * The behavioral verdict is computed here so the client and any future automation agree on one rule set.
 */
router.get("/oversight-matrix", requireAuth, requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30-day window

  const [{ data: members }, { data: usage }, { data: acts }, { data: sessions }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, name, email, avatar_url, role").eq("workspace_id", ws),
    supabase.from("ai_usage").select("user_id, total_tokens, created_at").eq("workspace_id", ws).gte("created_at", sinceIso),
    supabase.from("activities").select("actor_id, action, node_id, created_at").eq("workspace_id", ws).eq("actor_type", "human").order("created_at", { ascending: false }).limit(500),
    supabase.from("auth_refresh_tokens").select("user_id").is("revoked_at", null).gt("expires_at", new Date().toISOString()),
  ]);

  // Aggregate real per-operator token spend + inference-run count from ai_usage.
  const usageBy = new Map<string, { tokens: number; runs: number }>();
  for (const u of usage ?? []) {
    const k = String(u.user_id ?? "");
    if (!k) continue;
    const cur = usageBy.get(k) ?? { tokens: 0, runs: 0 };
    cur.tokens += Number(u.total_tokens ?? 0);
    cur.runs += 1;
    usageBy.set(k, cur);
  }
  // Latest human activity per actor (acts already newest-first).
  const lastAct = new Map<string, { action: string; node_id: string | null; created_at: string }>();
  for (const a of acts ?? []) {
    const k = String(a.actor_id ?? "");
    if (!k || lastAct.has(k)) continue;
    lastAct.set(k, { action: a.action as string, node_id: (a.node_id as string) ?? null, created_at: a.created_at as string });
  }
  const sessionUsers = new Set((sessions ?? []).map(s => String(s.user_id ?? "")));
  // Absolute cryptographic legitimacy: user_ids with a verified PoW claim in the window.
  const powUsers = await verifiedPowUserIds();

  const operators = (members ?? []).map(m => {
    const uid = String(m.user_id ?? "");
    const u = usageBy.get(uid) ?? { tokens: 0, runs: 0 };
    const last = lastAct.get(uid) ?? null;
    const hasSession = sessionUsers.has(uid);
    const verifiedPow = powUsers.has(uid);
    const taskCount = last ? (acts ?? []).filter(a => String(a.actor_id) === uid).length : 0;

    // ── Behavioral verdict (single source of truth), derived from REAL activity ──
    //   inactive       — no compute + no tasks in the window.
    //   low_engagement — many tasks but minimal compute each (shallow interaction).
    //   high_complexity— high compute-per-task → strategic deep-work.
    //   engaged        — actively transacting at a normal ratio.
    // NOTE: the old "bot" verdict (heavy use + no PoW claim) was REMOVED — PoW claims are
    // best-effort/client-side and frequently absent, so it false-flagged legitimate power users
    // (incl. owners) as "ANOMALOUS AUTOMATION / BOT DETECTED". Verdicts now key on real work only.
    const complexityDelta = Math.round(u.tokens / Math.max(1, taskCount)); // tokens per completed task
    let verdict: "inactive" | "bot" | "low_engagement" | "high_complexity" | "engaged" | "idle" = "idle";
    if (u.tokens === 0 && taskCount === 0) verdict = "inactive";
    else if (taskCount >= 5 && complexityDelta < 500) verdict = "low_engagement";
    else if (complexityDelta > 8_000) verdict = "high_complexity";
    else if (u.tokens > 0 || taskCount > 0) verdict = "engaged";

    return {
      operator_id: uid,
      name: (m.name as string) || (m.email as string) || "Unknown Operator",
      email: (m.email as string) || null,
      avatar_url: (m.avatar_url as string) ?? null,
      role: (m.role as string) || "member",
      tokens: u.tokens,
      runs: u.runs,
      task_count: taskCount,
      complexity_delta: complexityDelta,
      last_task_id: last?.node_id ?? null,
      last_action: last?.action ?? null,
      last_active_at: last?.created_at ?? null,
      has_session: hasSession,
      verified_pow: verifiedPow,
      verdict,
    };
  }).sort((a, b) => b.tokens - a.tokens);

  const totalTokens = operators.reduce((s, o) => s + o.tokens, 0);
  return c.json({ operators, totals: { operators: operators.length, tokens: totalTokens, active_sessions: sessionUsers.size } });
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
