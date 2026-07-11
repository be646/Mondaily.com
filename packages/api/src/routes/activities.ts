import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import { verifiedPowUserIds } from "../lib/pow-claims";
import { aiGateway, aiGatewayToolUse } from "../lib/ai-gateway";
import { workQuality, aggregateDeals, dailyTrend, evaluationLabel, type DealNode } from "../lib/oversight-metrics";

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
      object: node?.object_type ? { type: node.object_type, name: nodeName ?? null, node_id: (a.node_id as string) ?? null } : null,
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
  // Period filter (default 30d) — every windowed metric + trend recomputes for the chosen range.
  const days = Math.min(365, Math.max(1, Math.round(Number(c.req.query("days") ?? 30))));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const nowIso = new Date().toISOString();
  const [{ data: members }, { data: usage }, { data: acts }, { data: sessions }, { data: tasks }, { data: msgs }, { data: decisions }, { data: deals }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, name, email, avatar_url, role").eq("workspace_id", ws),
    // NOTE: without an explicit limit Supabase caps at 1000 rows, which UNDERCOUNTS AI usage for
    // any busy workspace. Raise it so the token totals reflect ALL usage in the window.
    supabase.from("ai_usage").select("user_id, total_tokens, created_at").eq("workspace_id", ws).gte("created_at", sinceIso).limit(100000),
    // Raised from 2000 so Activity trend + records-touched reflect ALL real activity in the window.
    supabase.from("activities").select("actor_id, action, node_id, created_at").eq("workspace_id", ws).eq("actor_type", "human").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(50000),
    supabase.from("auth_refresh_tokens").select("user_id").is("revoked_at", null).gt("expires_at", nowIso),
    // Real per-member task rollups (assignee-scoped): open / overdue / completed (+ completed_at for the trend).
    supabase.from("tasks").select("assignee_id, completed, due_date, completed_at").eq("workspace_id", ws).limit(5000),
    // Real per-member internal messages sent (30d) + decisions resolved (30d) — both workspace-scoped.
    supabase.from("internal_messages").select("sender_id, created_at").eq("workspace_id", ws).gte("created_at", sinceIso).limit(10000),
    supabase.from("decision_queue").select("resolved_by, resolved_at").eq("workspace_id", ws).gte("resolved_at", sinceIso).limit(10000),
    // Deal / opportunity nodes (workspace-scoped) — ownership lives in data (see oversight-metrics).
    supabase.from("nodes").select("id, object_type, data, created_by").eq("workspace_id", ws).or("object_type.ilike.%deal%,object_type.ilike.%opportunit%").limit(10000),
  ]);

  // Per-member message + decision-participation tallies (real counts, workspace-scoped).
  const msgBy = new Map<string, number>();
  for (const m of msgs ?? []) { const k = String(m.sender_id ?? ""); if (k) msgBy.set(k, (msgBy.get(k) ?? 0) + 1); }
  const decBy = new Map<string, number>();
  for (const d of decisions ?? []) { const k = String(d.resolved_by ?? ""); if (k) decBy.set(k, (decBy.get(k) ?? 0) + 1); }

  // Per-member deal tallies (owned/won/lost/open) from the real deal nodes.
  const memberRefs = (members ?? []).map(m => ({ user_id: String(m.user_id ?? ""), email: (m.email as string) ?? null, name: (m.name as string) ?? null }));
  const dealBy = aggregateDeals((deals ?? []) as DealNode[], memberRefs);
  // Deal node ids → count each member's real activity on a deal (a proxy for "deals updated").
  const dealIds = new Set((deals ?? []).map(d => String(d.id)));
  const dealsUpdatedBy = new Map<string, Set<string>>();
  for (const a of acts ?? []) {
    const uid = String(a.actor_id ?? ""); const nid = a.node_id ? String(a.node_id) : "";
    if (!uid || !nid || !dealIds.has(nid)) continue;
    if (!dealsUpdatedBy.has(uid)) dealsUpdatedBy.set(uid, new Set());
    dealsUpdatedBy.get(uid)!.add(nid);
  }

  // Team-wide daily trends (over the selected window, zero-filled) — all from real timestamps.
  const nowMs = Date.now();
  const completedTasks = (tasks ?? []).filter((t) => t.completed && t.completed_at);
  const trends = {
    activity: dailyTrend(acts ?? [], (a) => a.created_at as string, days, nowMs),
    ai_usage: dailyTrend(usage ?? [], (u) => u.created_at as string, days, nowMs, (u) => Number(u.total_tokens ?? 0)),
    decisions: dailyTrend(decisions ?? [], (d) => d.resolved_at as string, days, nowMs),
    // Real completed-work trend, now that tasks carry completed_at (migration 0019).
    tasks_completed: dailyTrend(completedTasks, (t) => t.completed_at as string, days, nowMs),
  };

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
    // REAL task count for this member (open + completed from the tasks table) — NOT activity-event
    // count. The old activity-based count was capped by the activities limit and never moved when
    // tasks were added; this reflects their actual assigned tasks and updates as work changes.
    const taskAggU = taskAgg.get(uid) ?? { open: 0, overdue: 0, completed: 0 };
    const taskCount = taskAggU.open + taskAggU.completed;

    // ── Behavioral verdict (single source of truth), derived from REAL activity ──
    //   inactive       — no compute + no tasks in the window.
    //   low_engagement — many tasks but minimal compute each (shallow interaction).
    //   high_complexity— high compute-per-task → strategic deep-work.
    //   engaged        — actively transacting at a normal ratio.
    // NOTE: the old "bot" verdict (heavy use + no PoW claim) was REMOVED — PoW claims are
    // best-effort/client-side and frequently absent, so it false-flagged legitimate power users
    // (incl. owners) as "ANOMALOUS AUTOMATION / BOT DETECTED". Verdicts now key on real work only.
    // tokens per task — only meaningful when tasks exist. With 0 tasks, dividing by 1 would surface
    // the raw token count as a giant "per-task" number and mislabel the member as high_complexity.
    const complexityDelta = taskCount > 0 ? Math.round(u.tokens / taskCount) : 0;
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
      // Real per-member deal tallies + "deals updated" (activity on deal nodes).
      deals_owned: dealBy.get(uid)?.owned ?? 0,
      deals_won: dealBy.get(uid)?.won ?? 0,
      deals_lost: dealBy.get(uid)?.lost ?? 0,
      deals_open: dealBy.get(uid)?.open ?? 0,
      deals_updated: dealsUpdatedBy.get(uid)?.size ?? 0,
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
      // Single admin-evaluation headline (source-backed label, not a score).
      evaluation: evaluationLabel({
        open_tasks: taskAgg.get(uid)?.open ?? 0,
        overdue_tasks: taskAgg.get(uid)?.overdue ?? 0,
        task_count: taskCount,
        decisions_resolved: decBy.get(uid) ?? 0,
      }),
    };
  }).sort((a, b) => b.tokens - a.tokens);

  const totalTokens = operators.reduce((s, o) => s + o.tokens, 0);
  return c.json({ operators, trends, totals: { operators: operators.length, tokens: totalTokens, active_sessions: sessionUsers.size } });
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
    supabase.from("ai_usage").select("total_tokens, created_at").eq("workspace_id", ws).eq("user_id", actorId).gte("created_at", sinceIso).limit(100000),
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
    const { text } = await aiGateway({ system, prompt: digest, maxTokens: 240, workspaceId: ws, userId: c.get("userId"), feature: "oversight_insight" });
    const insight = (text || "").trim();
    return c.json({ insight: insight || "I don't have enough tracked activity for this member yet.", sources, sufficient: true });
  } catch {
    return c.json({ insight: "The AI service is unavailable right now — please try again in a moment.", sources, sufficient: true });
  }
});

/**
 * AI work-EFFICIENCY review — admin-only, on-demand. Produces a STRUCTURED, grounded assessment of
 * one member's real work: an efficiency rating, a factual assessment, concrete strengths + concrete
 * improvement areas, and a warm coaching message a manager could actually send. Uses ONLY the real
 * metrics below — never invents workload, hours, or achievements. Honest "insufficient" when thin.
 */
router.post("/member-efficiency", requireAuth, requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json<{ actor_id?: string }>().catch(() => ({} as { actor_id?: string }));
  const actorId = String(body.actor_id ?? "");
  if (!actorId) return c.json({ error: "actor_id required" }, 400);

  const nowIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: member }, { data: usage }, { data: acts }, { data: tasks }, { data: decisions }, { data: msgs }] = await Promise.all([
    supabase.from("workspace_members").select("name, email, role").eq("workspace_id", ws).eq("user_id", actorId).maybeSingle(),
    supabase.from("ai_usage").select("total_tokens").eq("workspace_id", ws).eq("user_id", actorId).gte("created_at", sinceIso).limit(100000),
    supabase.from("activities").select("action, created_at").eq("workspace_id", ws).eq("actor_id", actorId).gte("created_at", sinceIso).limit(50000),
    supabase.from("tasks").select("completed, due_date, completed_at").eq("workspace_id", ws).eq("assignee_id", actorId).limit(5000),
    supabase.from("decision_queue").select("resolved_by").eq("workspace_id", ws).eq("resolved_by", actorId).gte("resolved_at", sinceIso).limit(10000),
    supabase.from("internal_messages").select("sender_id").eq("workspace_id", ws).eq("sender_id", actorId).gte("created_at", sinceIso).limit(10000),
  ]);
  if (!member) return c.json({ error: "Member not found in this workspace." }, 404);

  const taskRoll = { open: 0, overdue: 0, completed: 0 };
  for (const t of tasks ?? []) {
    if (t.completed) taskRoll.completed += 1;
    else { taskRoll.open += 1; if (t.due_date && String(t.due_date) < nowIso) taskRoll.overdue += 1; }
  }
  const totalTasks = taskRoll.open + taskRoll.completed;
  const completionRate = totalTasks > 0 ? Math.round((taskRoll.completed / totalTasks) * 100) : 0;
  const tokens = (usage ?? []).reduce((s, u) => s + Number(u.total_tokens ?? 0), 0);
  const activityCount = (acts ?? []).length;
  const decisionsResolved = (decisions ?? []).length;
  const messagesSent = (msgs ?? []).length;
  const activeDays = new Set((acts ?? []).map(a => String(a.created_at).slice(0, 10))).size;

  // Not enough real signal → honest response, no model call.
  if (tokens === 0 && activityCount === 0 && totalTasks === 0 && decisionsResolved === 0) {
    return c.json({ sufficient: false, rating: "insufficient", assessment: "There isn't enough tracked work for this member yet to assess efficiency.", strengths: [], improvements: [], coaching_message: "" });
  }

  const digest = [
    `Member: ${member.name ?? "Unknown"}${member.email ? ` (${member.email})` : ""}, role ${member.role ?? "member"}. Window: last 30 days.`,
    `Tasks — completed ${taskRoll.completed}, open ${taskRoll.open}, overdue ${taskRoll.overdue}; completion rate ${completionRate}%.`,
    `Decisions resolved: ${decisionsResolved}. Internal messages sent: ${messagesSent}.`,
    `Recorded activity events: ${activityCount} across ${activeDays} active day(s).`,
    `AI credits (tokens) used: ${tokens}.`,
  ].join("\n");

  const system =
    "You are a supportive team-performance coach for a workspace manager. Using ONLY the real metrics provided, assess ONE member's work EFFICIENCY. " +
    "Be honest, specific, and constructive — cite the actual numbers. NEVER invent tasks, hours, achievements, or problems the data doesn't show. " +
    "Give: a rating (strong = high throughput + high completion + low overdue; steady = solid/consistent; needs_support = low completion, high overdue, or very low activity); " +
    "a 2-4 sentence assessment grounded in the numbers; 1-3 concrete strengths; 1-3 concrete, actionable improvements; and a short, warm, respectful coaching message the manager could send directly to the member (first person, encouraging, references the real data). " +
    "If the data is genuinely too thin, set rating to 'insufficient' and keep arrays empty.";
  const schema = {
    type: "object" as const,
    properties: {
      rating: { type: "string", enum: ["strong", "steady", "needs_support", "insufficient"] },
      assessment: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      improvements: { type: "array", items: { type: "string" } },
      coaching_message: { type: "string" },
    },
    required: ["rating", "assessment", "strengths", "improvements", "coaching_message"],
  };

  try {
    const result = await aiGatewayToolUse({
      system, prompt: digest, toolName: "work_efficiency_review",
      toolDescription: "Return a grounded work-efficiency review of the member.",
      toolSchema: schema, maxTokens: 700, workspaceId: ws, userId: c.get("userId"), feature: "member_efficiency",
    });
    const r = (result ?? {}) as { rating?: string; assessment?: string; strengths?: string[]; improvements?: string[]; coaching_message?: string };
    return c.json({
      sufficient: true,
      rating: ["strong", "steady", "needs_support"].includes(String(r.rating)) ? r.rating : "steady",
      assessment: (r.assessment ?? "").trim(),
      strengths: Array.isArray(r.strengths) ? r.strengths.slice(0, 3) : [],
      improvements: Array.isArray(r.improvements) ? r.improvements.slice(0, 3) : [],
      coaching_message: (r.coaching_message ?? "").trim(),
      metrics: { completion_rate: completionRate, completed: taskRoll.completed, overdue: taskRoll.overdue, active_days: activeDays, decisions: decisionsResolved },
    });
  } catch {
    return c.json({ sufficient: false, rating: "insufficient", assessment: "The AI service is unavailable right now — please try again in a moment.", strengths: [], improvements: [], coaching_message: "" });
  }
});

/**
 * Grounded Oversight Ask — admin-only team Q&A over REAL member metrics only. No tools, no
 * hallucination: the model is handed a digest built entirely from the database and told to answer
 * strictly from it, or say the data is insufficient. Returns the source lines it was grounded on.
 */
router.post("/oversight-ask", requireAuth, requireAdminRole, async (c) => {
  const ws = c.get("workspaceId");
  const body = await c.req.json().catch(() => ({})) as { question?: string };
  const question = (body.question ?? "").trim();
  if (!question) return c.json({ answer: "Ask a question about your team's activity.", sources: [], sufficient: false });

  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const [{ data: members }, { data: usage }, { data: tasks }, { data: decisions }, { data: deals }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, name, email, role").eq("workspace_id", ws),
    supabase.from("ai_usage").select("user_id, total_tokens").eq("workspace_id", ws).gte("created_at", sinceIso),
    supabase.from("tasks").select("assignee_id, completed, due_date").eq("workspace_id", ws).limit(5000),
    supabase.from("decision_queue").select("resolved_by").eq("workspace_id", ws).gte("resolved_at", sinceIso).limit(10000),
    supabase.from("nodes").select("id, object_type, data, created_by").eq("workspace_id", ws).or("object_type.ilike.%deal%,object_type.ilike.%opportunit%").limit(10000),
  ]);

  const tokBy = new Map<string, number>();
  for (const u of usage ?? []) { const k = String(u.user_id ?? ""); if (k) tokBy.set(k, (tokBy.get(k) ?? 0) + Number(u.total_tokens ?? 0)); }
  const taskAgg = new Map<string, { open: number; overdue: number; completed: number }>();
  for (const t of tasks ?? []) {
    const uid = String(t.assignee_id ?? ""); if (!uid) continue;
    const cur = taskAgg.get(uid) ?? { open: 0, overdue: 0, completed: 0 };
    if (t.completed) cur.completed += 1; else { cur.open += 1; if (t.due_date && String(t.due_date) < nowIso) cur.overdue += 1; }
    taskAgg.set(uid, cur);
  }
  const decBy = new Map<string, number>();
  for (const d of decisions ?? []) { const k = String(d.resolved_by ?? ""); if (k) decBy.set(k, (decBy.get(k) ?? 0) + 1); }
  const memberRefs = (members ?? []).map(m => ({ user_id: String(m.user_id ?? ""), email: (m.email as string) ?? null, name: (m.name as string) ?? null }));
  const dealBy = aggregateDeals((deals ?? []) as DealNode[], memberRefs);

  // One grounded line per member — these ARE the sources.
  const lines = (members ?? []).map(m => {
    const uid = String(m.user_id ?? "");
    const t = taskAgg.get(uid) ?? { open: 0, overdue: 0, completed: 0 };
    const d = dealBy.get(uid) ?? { owned: 0, won: 0, lost: 0, open: 0 };
    return `${m.name ?? m.email ?? "Member"} (${m.role ?? "member"}): tasks open ${t.open}, overdue ${t.overdue}, completed ${t.completed}; decisions resolved ${decBy.get(uid) ?? 0}; deals owned ${d.owned} (won ${d.won}, lost ${d.lost}, open ${d.open}); AI credits ${tokBy.get(uid) ?? 0}.`;
  });

  const anyData = (tasks?.length ?? 0) > 0 || (usage?.length ?? 0) > 0 || (decisions?.length ?? 0) > 0 || (deals?.length ?? 0) > 0;
  if (!anyData || lines.length === 0) {
    return c.json({ answer: "I don't have enough tracked team activity to answer that yet.", sources: [], sufficient: false });
  }

  const digest = [`Team of ${lines.length} member(s), last 30 days:`, ...lines].join("\n");
  const system =
    "You are a workspace admin assistant. Answer the admin's question about their team using ONLY the per-member data provided. " +
    "Never invent members, tasks, deals, decisions, numbers, hours, or productivity scores. Cite real numbers from the data. " +
    "Do NOT mention tools, databases, or your reasoning. Keep it to a few plain sentences. " +
    "If the data does not contain enough to answer, reply exactly: \"I don't have enough tracked team activity to answer that yet.\"";

  try {
    const { text } = await aiGateway({ system, prompt: `Question: ${question}\n\nData:\n${digest}`, maxTokens: 320, workspaceId: ws, userId: c.get("userId"), feature: "oversight_ask" });
    const answer = (text || "").trim();
    const sources = lines.map((l) => ({ type: "member_metrics" as const, title: l }));
    return c.json({ answer: answer || "I don't have enough tracked team activity to answer that yet.", sources, sufficient: true });
  } catch {
    return c.json({ answer: "The AI service is unavailable right now — please try again in a moment.", sources: [], sufficient: true });
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
