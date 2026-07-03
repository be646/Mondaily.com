import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { verifiedPowUserIds } from "../lib/pow-claims";
import { aiGateway } from "../lib/ai-gateway";
import { workQuality } from "../lib/oversight-metrics";

const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();

/**
 * REAL 14-day trends for the home Workspace Graph Pulse — daily creation counts computed from
 * actual created_at timestamps (nodes / tasks / risk notifications). This replaces the old
 * decorative "curve rising to current level" with genuine history: every point is a real count.
 */
router.get("/trends", requireAuth, async (c) => {
  const ws = c.get("workspaceId");
  const DAYS = 14;
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const dayKeys: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) dayKeys.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const emptySeries = () => Object.fromEntries(dayKeys.map((d) => [d, 0])) as Record<string, number>;
  const bucket = (rows: { created_at: string }[] | null | undefined, into: Record<string, number>) => {
    for (const r of rows ?? []) {
      const k = String(r.created_at).slice(0, 10);
      if (k in into) into[k] = (into[k] ?? 0) + 1;
    }
  };

  const [nodes, tasks, risks] = await Promise.all([
    supabase.from("nodes").select("created_at, object_type").eq("workspace_id", ws).gte("created_at", sinceIso).limit(5000),
    supabase.from("tasks").select("created_at").eq("workspace_id", ws).gte("created_at", sinceIso).limit(5000),
    supabase.from("notifications").select("created_at").eq("workspace_id", ws).eq("type", "ai_risk").gte("created_at", sinceIso).limit(2000),
  ]);

  const records = emptySeries(), relationships = emptySeries(), workflows = emptySeries(), taskSeries = emptySeries(), riskSeries = emptySeries();
  bucket(nodes.data, records);
  bucket((nodes.data ?? []).filter((n) => /person|people|company|companies|contact/i.test(String(n.object_type))), relationships);
  bucket((nodes.data ?? []).filter((n) => String(n.object_type) === "automation"), workflows);
  bucket(tasks.data, taskSeries);
  bucket(risks.data, riskSeries);

  const toArr = (s: Record<string, number>) => dayKeys.map((d) => s[d] ?? 0);
  return c.json({
    days: dayKeys,
    series: {
      records: toArr(records),
      relationships: toArr(relationships),
      workflows: toArr(workflows),
      tasksOpen: toArr(taskSeries),
      risks: toArr(riskSeries),
    },
  });
});

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
    .select("id, actor_type, actor_id, action, ai_summary, node_id, created_at, diff, nodes(object_type, data)")
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

  // Turn the raw diff into a readable "field → value" change list so admins see EXACTLY what changed.
  const readableChanges = (diff: unknown): { field: string; value: string }[] => {
    if (!diff || typeof diff !== "object") return [];
    // Activities store the patch payload; the real field changes live under diff.data (node updates).
    const d = diff as Record<string, unknown>;
    const src = (d.data && typeof d.data === "object" ? d.data : d) as Record<string, unknown>;
    return Object.entries(src)
      .filter(([k]) => !["type", "data"].includes(k))
      .slice(0, 8)
      .map(([field, v]) => ({
        field: field.replace(/_/g, " "),
        value: v == null ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 80),
      }));
  };

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
      changes: readableChanges((a as { diff?: unknown }).diff),   // exactly what changed
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

  const nowIso = new Date().toISOString();
  const [{ data: members }, { data: usage }, { data: acts }, { data: sessions }, { data: tasks }, { data: msgs }, { data: decisions }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, name, email, avatar_url, role").eq("workspace_id", ws),
    supabase.from("ai_usage").select("user_id, total_tokens, created_at").eq("workspace_id", ws).gte("created_at", sinceIso),
    supabase.from("activities").select("actor_id, action, node_id, created_at").eq("workspace_id", ws).eq("actor_type", "human").order("created_at", { ascending: false }).limit(2000),
    supabase.from("auth_refresh_tokens").select("user_id").is("revoked_at", null).gt("expires_at", nowIso),
    // Real per-member task rollups (assignee-scoped): open / overdue / completed.
    supabase.from("tasks").select("assignee_id, completed, due_date").eq("workspace_id", ws).limit(5000),
    // Real per-member internal messages sent (30d) + decisions resolved (30d) — both workspace-scoped.
    supabase.from("internal_messages").select("sender_id").eq("workspace_id", ws).gte("created_at", sinceIso).limit(10000),
    supabase.from("decision_queue").select("resolved_by").eq("workspace_id", ws).gte("resolved_at", sinceIso).limit(10000),
  ]);

  // Per-member message + decision-participation tallies (real counts, workspace-scoped).
  const msgBy = new Map<string, number>();
  for (const m of msgs ?? []) { const k = String(m.sender_id ?? ""); if (k) msgBy.set(k, (msgBy.get(k) ?? 0) + 1); }
  const decBy = new Map<string, number>();
  for (const d of decisions ?? []) { const k = String(d.resolved_by ?? ""); if (k) decBy.set(k, (decBy.get(k) ?? 0) + 1); }

  // Per-member task aggregates (all real, current-state).
  const taskAgg = new Map<string, { open: number; overdue: number; completed: number }>();
  for (const t of tasks ?? []) {
    const uid = String(t.assignee_id ?? "");
    if (!uid) continue;
    const cur = taskAgg.get(uid) ?? { open: 0, overdue: 0, completed: 0 };
    if (t.completed) cur.completed += 1;
    else { cur.open += 1; if (t.due_date && String(t.due_date) < nowIso) cur.overdue += 1; }
    taskAgg.set(uid, cur);
  }
  // Distinct records each member touched in the window (real, from activity node_ids).
  const touchedBy = new Map<string, Set<string>>();
  for (const a of acts ?? []) {
    const uid = String(a.actor_id ?? ""); const nid = a.node_id ? String(a.node_id) : "";
    if (!uid || !nid) continue;
    if (!touchedBy.has(uid)) touchedBy.set(uid, new Set());
    touchedBy.get(uid)!.add(nid);
  }

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
      // Real per-member work rollups (retire the "Not tracked yet" placeholders).
      records_touched: touchedBy.get(uid)?.size ?? 0,
      open_tasks: taskAgg.get(uid)?.open ?? 0,
      overdue_tasks: taskAgg.get(uid)?.overdue ?? 0,
      completed_tasks: taskAgg.get(uid)?.completed ?? 0,
      messages_sent: msgBy.get(uid) ?? 0,
      decisions_resolved: decBy.get(uid) ?? 0,
      last_task_id: last?.node_id ?? null,
      last_action: last?.action ?? null,
      last_active_at: last?.created_at ?? null,
      has_session: hasSession,
      verified_pow: verifiedPow,
      verdict,
      // Source-backed work-quality signals derived from the real metrics above.
      quality: workQuality({
        open_tasks: taskAgg.get(uid)?.open ?? 0,
        overdue_tasks: taskAgg.get(uid)?.overdue ?? 0,
        completed_tasks: taskAgg.get(uid)?.completed ?? 0,
        task_count: taskCount,
        decisions_resolved: decBy.get(uid) ?? 0,
        last_active_at: last?.created_at ?? null,
      }),
    };
  }).sort((a, b) => b.tokens - a.tokens);

  const totalTokens = operators.reduce((s, o) => s + o.tokens, 0);
  return c.json({ operators, totals: { operators: operators.length, tokens: totalTokens, active_sessions: sessionUsers.size } });
});

/**
 * Team Insights — grounded per-member AI summary. Admin-only.
 *
 * This is DELIBERATELY NOT the general Ask agent: the Ask agent does tool-use and, on the
 * reasoning model, leaked its planning ("We need to call tools. I'll call search_records…")
 * and returned "No sources returned." Here we assemble the member's REAL telemetry server-side
 * and ask the gateway for a plain-prose completion with NO tools — so there is nothing to leak
 * and nothing to invent: the model only sees the data below. If the data is thin we return the
 * honest insufficient-data message WITHOUT calling the model at all.
 */
router.post("/member-insight", requireAuth, requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json<{ actor_id?: string }>().catch(() => ({} as { actor_id?: string }));
  const actorId = String(body.actor_id ?? "");
  if (!actorId) return c.json({ error: "actor_id required" }, 400);

  const nowIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: member }, { data: usage }, { data: acts }, { data: sessions }, { data: tasks }] = await Promise.all([
    supabase.from("workspace_members").select("name, email, role").eq("workspace_id", ws).eq("user_id", actorId).maybeSingle(),
    supabase.from("ai_usage").select("total_tokens, created_at").eq("workspace_id", ws).eq("user_id", actorId).gte("created_at", sinceIso),
    supabase.from("activities").select("action, created_at, nodes(object_type, data)").eq("workspace_id", ws).eq("actor_id", actorId).order("created_at", { ascending: false }).limit(30),
    supabase.from("auth_refresh_tokens").select("user_id").eq("user_id", actorId).is("revoked_at", null).gt("expires_at", nowIso),
    supabase.from("tasks").select("completed, due_date").eq("workspace_id", ws).eq("assignee_id", actorId).limit(2000),
  ]);

  const taskRoll = { open: 0, overdue: 0, completed: 0 };
  for (const t of tasks ?? []) {
    if (t.completed) taskRoll.completed += 1;
    else { taskRoll.open += 1; if (t.due_date && String(t.due_date) < nowIso) taskRoll.overdue += 1; }
  }

  // The subject must be a real member of THIS workspace before we generate anything.
  if (!member) return c.json({ error: "Member not found in this workspace." }, 404);

  const tokens = (usage ?? []).reduce((s, u) => s + Number(u.total_tokens ?? 0), 0);
  const activities = (acts ?? []).map((a) => {
    const node = (a as { nodes?: { object_type?: string; data?: Record<string, unknown> } | null }).nodes;
    const name = (node?.data?.name ?? node?.data?.title) as string | undefined;
    return { action: a.action as string, object_type: node?.object_type ?? null, name: name ?? null, at: a.created_at as string };
  });
  const hasSession = (sessions ?? []).length > 0;

  // Real source cards — every one is an actual activity row (never fabricated).
  const sources = activities.slice(0, 12).map((a) => ({
    type: "activity" as const,
    title: `${a.action}${a.object_type ? ` · ${a.object_type}` : ""}${a.name ? ` "${a.name}"` : ""}`,
    timestamp: a.at,
  }));

  // Not enough tracked activity → honest message, no model call.
  if (tokens === 0 && activities.length === 0 && taskRoll.open === 0 && taskRoll.completed === 0) {
    return c.json({ insight: "I don't have enough tracked activity for this member yet.", sources: [], sufficient: false });
  }

  const digest = [
    `Member: ${member?.name ?? "Unknown"}${member?.email ? ` (${member.email})` : ""}, role ${member?.role ?? "member"}.`,
    `Live session right now: ${hasSession ? "yes" : "no"}.`,
    `AI credits (tokens) used in last 30 days: ${tokens}.`,
    `Recorded activity events in last 30 days: ${activities.length}.`,
    `Assigned tasks — open: ${taskRoll.open}, overdue: ${taskRoll.overdue}, completed: ${taskRoll.completed}.`,
    "Recent activity (newest first):",
    ...activities.slice(0, 20).map((a) => `- ${a.at}: ${a.action}${a.object_type ? ` ${a.object_type}` : ""}${a.name ? ` "${a.name}"` : ""}`),
  ].join("\n");

  const system =
    "You are a workspace admin assistant. Summarise ONE team member's real activity using ONLY the data provided. " +
    "Never invent tasks, deals, notes, numbers, workload, hours, or coaching that the data does not support. " +
    "Write 2 to 4 short, plain sentences of factual observation. " +
    "Do NOT mention tools, functions, searching, databases, or your own reasoning process. " +
    "If the data is too thin to say anything useful, reply exactly: \"I don't have enough tracked activity for this member yet.\"";

  try {
    const { text } = await aiGateway({ system, prompt: digest, maxTokens: 240 });
    const insight = (text || "").trim();
    return c.json({ insight: insight || "I don't have enough tracked activity for this member yet.", sources, sufficient: true });
  } catch {
    return c.json({ insight: "The AI service is unavailable right now — please try again in a moment.", sources, sufficient: true });
  }
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
