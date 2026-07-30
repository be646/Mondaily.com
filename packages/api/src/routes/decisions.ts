import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireAdminRole } from "../middleware/rbac";
import { denyViewerWrites } from "../middleware/rbac";
import { supabase } from "@mondaily/db/client";
import * as ubc from "@mondaily/db/ubc";
import { inngest } from "../lib/inngest";
import { objectTypeToVertical, type ProspectCandidate } from "./prospecting";
import { logDecisionTrainingExample, type TrainingAction } from "../lib/training-ledger";
import { sendWorkspaceEmail } from "../lib/mail";
import { describeExecution } from "../lib/decision-actions";
import { aiGateway, aiGatewayToolUse } from "../lib/ai-gateway";
import { CreditsExhaustedError } from "../lib/credits";
import { readAutonomy, maybeAutoApprove, getLearnedPreferences, learnedGuidanceFor } from "../lib/autonomy";
import { createNotification } from "../lib/notify";

type Variables = { userId: string; workspaceId: string; role: string };
const router = new Hono<{ Variables: Variables }>();
router.use("*", requireAuth);
router.use("*", denyViewerWrites); // viewers are read-only

/**
 * Decision Queue — the real backing store for "agents recommend, humans
 * approve." Every row here is created by a real signal (overdue task,
 * stale relationship, overdue invoice, credit note dispute, or an Ask
 * Mondaily recommendation) — never fabricated. `confidence` is nullable
 * and only set when a caller actually computed one; the frontend must
 * show "source-backed" rather than a number when it's null.
 */

/** The only states a decision can still be resolved FROM. approved/rejected/completed are terminal. */
const OPEN_STATUSES = ["pending", "snoozed"];

const evidenceItem = z.object({
  type: z.string(),
  title: z.string(),
  node_id: z.string().optional(),
  object_type: z.string().optional(),
  relationship: z.string().optional(),
  match_reason: z.string().optional(),
  timestamp: z.string().optional(),
});

const createSchema = z.object({
  source_type: z.string(),
  source_id: z.string().optional(),
  agent_name: z.string(),
  title: z.string().min(1),
  summary: z.string().optional(),
  recommended_action: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).default("low"),
  confidence: z.number().min(0).max(100).optional(),
  evidence: z.array(evidenceItem).default([]),
});

// Attach a human-readable "what happens if approved" preview to each decision (no new columns).
const withPreview = (d: Record<string, unknown>) => ({ ...d, execution_preview: describeExecution(d as { agent_name?: string; source_type?: string; evidence?: unknown }) });

router.get("/", async (c) => {
  const workspaceId = c.get("workspaceId");
  const status = c.req.query("status");
  const view = c.req.query("view");

  // Wake elapsed snoozes. `snoozed_until` was written by the snooze routes and then read by
  // NOTHING on the server — no cron, no job — so a snoozed decision sat in "Needs more
  // context" forever, permanently showing "wakes soon" once the timestamp passed. Doing it
  // here makes it self-healing on read: no scheduler to deploy, no drift if one stops.
  // Skipped when the caller asked only for a terminal lane (?status=approved/rejected/completed):
  // waking snoozes can't change that result, and this is a WRITE on a read path.
  if (!status || OPEN_STATUSES.includes(status)) {
    await supabase
      .from("decision_queue")
      .update({ status: "pending", snoozed_until: null })
      .eq("workspace_id", workspaceId)
      .eq("status", "snoozed")
      .lte("snoozed_until", new Date().toISOString());
  }

  // Cockpit view: open lanes (pending + snoozed) in full, plus a bounded window of recently
  // resolved decisions (approved/rejected/completed) so the "recent activity" lanes stay light.
  if (view === "cockpit") {
    const [open, resolved] = await Promise.all([
      supabase.from("decision_queue").select("*").eq("workspace_id", workspaceId).in("status", ["pending", "snoozed"]).order("created_at", { ascending: false }).limit(1000),
      supabase.from("decision_queue").select("*").eq("workspace_id", workspaceId).in("status", ["approved", "rejected", "completed"]).order("resolved_at", { ascending: false }).limit(120),
    ]);
    if (open.error) return c.json({ error: open.error.message }, 500);
    const rows = [...(open.data ?? []), ...(resolved.data ?? [])].map(withPreview);
    return c.json(rows);
  }

  let query = supabase
    .from("decision_queue")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    // Was 100 — which capped the pending COUNT at 100 so approvals never appeared
    // to reduce it. Raised so the queue + its count reflect reality.
    .limit(1000);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json((data ?? []).map(withPreview));
});

// ── Agent autonomy dial ──────────────────────────────────────────────────────
// How much agents may self-approve WITHOUT a human. Stored on workspaces.settings.agent_autonomy.
//   manual     — everything waits for approval (default; the historical behaviour).
//   assisted   — LOW-risk decisions auto-approve + execute; medium/high still queue.
//   autonomous — LOW + MEDIUM auto-approve + execute; HIGH always queues.
// HIGH-risk NEVER auto-runs at any level. Every auto-approval is logged (resolved_by='autonomy').
// readAutonomy / autoApproves / maybeAutoApprove now live in lib/autonomy.ts — the single source
// used by BOTH this route and every background agent, so autonomy applies wherever a decision is
// created (previously only decisions made through POST /decisions were ever auto-approved).

router.get("/autonomy", async (c) => c.json({ level: await readAutonomy(c.get("workspaceId")) }));

// Agent reasoning on/off — when off, agents stay on the cheap rule-based path (no per-finding AI).
// Default ON. (Depth/budget scales with the plan tier in lib/agent-reasoning.)
router.get("/reasoning", async (c) => {
  const { data } = await supabase.from("workspaces").select("settings").eq("id", c.get("workspaceId")).maybeSingle();
  const enabled = ((data?.settings as { agent_reasoning?: boolean } | null)?.agent_reasoning) !== false;
  return c.json({ enabled });
});
router.patch("/reasoning", zValidator("json", z.object({ enabled: z.boolean() })), async (c) => {
  const workspaceId = c.get("workspaceId");
  const { enabled } = c.req.valid("json");
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), agent_reasoning: enabled };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", workspaceId);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ enabled });
});
// requireAdminRole: the autonomy dial decides whether agents WRITE UNATTENDED. It was open to any
// member (only requireAuth at router level) — found while putting the dial on the Owner Console.
router.patch("/autonomy", requireAdminRole, zValidator("json", z.object({ level: z.enum(["manual", "assisted", "autonomous"]) })), async (c) => {
  const workspaceId = c.get("workspaceId");
  const { level } = c.req.valid("json");
  const { data } = await supabase.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), agent_autonomy: level };
  const { error } = await supabase.from("workspaces").update({ settings }).eq("id", workspaceId);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ level });
});

// Agent scorecard — the trust surface for autonomy. Per agent over a window: how many decisions
// it raised, the human approval rate (trust), how many it auto-approved via autonomy, and pending.
// All from the real decision_queue; nothing invented. Registered before /:id.
router.get("/agent-scorecard", async (c) => {
  const workspaceId = c.get("workspaceId");
  const days = Math.min(365, Math.max(1, Math.round(Number(c.req.query("days") ?? 30))));
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase.from("decision_queue")
    .select("agent_name, status, resolved_by, risk_level, created_at")
    .eq("workspace_id", workspaceId).gte("created_at", sinceIso).limit(8000);
  type Row = { agent: string; raised: number; approved: number; rejected: number; auto_approved: number; pending: number };
  const byAgent: Record<string, Row> = {};
  for (const d of data ?? []) {
    const a = String(d.agent_name || "unknown");
    const b = (byAgent[a] ??= { agent: a, raised: 0, approved: 0, rejected: 0, auto_approved: 0, pending: 0 });
    b.raised++;
    if (d.status === "approved" || d.status === "completed") { b.approved++; if (d.resolved_by === "autonomy") b.auto_approved++; }
    else if (d.status === "rejected") b.rejected++;
    else if (d.status === "pending") b.pending++;
  }
  const agents = Object.values(byAgent)
    .map(b => {
      const resolved = b.approved + b.rejected;
      const approval_rate = resolved ? Math.round((b.approved / resolved) * 100) : null;
      // Learned trust signal: an agent you've approved ≥90% of over a meaningful sample is a safe
      // candidate to let self-approve. This is what turns the raw history into an actionable nudge.
      const autonomy_ready = approval_rate != null && approval_rate >= 90 && resolved >= 20;
      return { ...b, resolved, approval_rate, autonomy_ready };
    })
    .sort((x, y) => y.raised - x.raised);
  return c.json({ days, agents });
});

// Learning loop — what agents have LEARNED you want, from your real approve/reject history, broken
// down per agent + decision type. Deterministic (no AI); registered before /:id so the literal wins.
router.get("/learned-preferences", async (c) => {
  const prefs = await getLearnedPreferences(c.get("workspaceId"));
  const favored = prefs.filter((p) => p.verdict === "favored").length;
  const disfavored = prefs.filter((p) => p.verdict === "disfavored").length;
  return c.json({ preferences: prefs, summary: { favored, disfavored, patterns: prefs.length } });
});

// Chief of Staff — a meta-agent that reasons ACROSS every agent's pending decisions and ranks the
// TOP 3 things that most need the operator right now (by real impact + urgency, not just the risk
// label), each with a why + the single next action. Registered before /:id.
router.get("/chief-of-staff", async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data: pending } = await supabase.from("decision_queue")
    .select("id, agent_name, title, summary, risk_level, source_type, created_at")
    .eq("workspace_id", workspaceId).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(30);
  if (!pending?.length) return c.json({ priorities: [], count: 0 });
  const digest = pending.map((d, i) => `[${i}] agent=${d.agent_name} risk=${d.risk_level} :: ${d.title} — ${String(d.summary ?? "").slice(0, 160)}`).join("\n").slice(0, 9000);
  try {
    const out = await aiGatewayToolUse({
      system: "You are the Chief of Staff for a business operator. Given the pending agent decisions across the whole workspace, pick the TOP 3 that most need the operator's attention RIGHT NOW — judged by real business impact and urgency, NOT just the risk label. For each: a short title, a one-line 'why' it's the priority, and the single concrete next action. Ground strictly in the given items; never invent.",
      prompt: `Pending decisions:\n${digest}\n\nReturn the 3 highest-priority items (fewer if there are fewer).`,
      toolName: "prioritize",
      toolDescription: "The top priorities for the operator",
      toolSchema: { type: "object", properties: { priorities: { type: "array", items: { type: "object", properties: { index: { type: "number" }, title: { type: "string" }, why: { type: "string" }, action: { type: "string" } }, required: ["title", "why", "action"] } } }, required: ["priorities"] },
      maxTokens: 700, workspaceId, userId: c.get("userId"), feature: "chief_of_staff", taskClass: "reasoning",
    });
    const raw = Array.isArray((out as { priorities?: unknown[] }).priorities) ? (out as { priorities: { index?: number; title?: string; why?: string; action?: string }[] }).priorities : [];
    const priorities = raw.slice(0, 3).map((p) => {
      const d = typeof p.index === "number" ? pending[p.index] : undefined;
      return { title: String(p.title ?? "").slice(0, 160), why: String(p.why ?? "").slice(0, 240), action: String(p.action ?? "").slice(0, 240), decision_id: d?.id ?? null, agent_name: d?.agent_name ?? null };
    }).filter((p) => p.title);
    return c.json({ priorities, count: pending.length });
  } catch {
    return c.json({ priorities: [], count: pending.length, error: "unavailable" });
  }
});

// Goal-directed planning — an agent turns a goal into an ordered, concrete plan of steps (each with
// a risk level). Pure planning: NO side effects here. The client reviews, then dispatches steps into
// the decision queue (POST /), where the autonomy dial + human approval govern execution. Honest:
// grounded in realistic business actions; never invents specific data.
router.post("/plan-goal", zValidator("json", z.object({ goal: z.string().min(1).max(500), agent_name: z.string().max(60).optional() })), async (c) => {
  const { goal, agent_name } = c.req.valid("json");
  try {
    // Learning loop (actuation): bias the plan toward action types this user actually approves.
    const guidance = await learnedGuidanceFor(c.get("workspaceId"));
    const result = await aiGatewayToolUse({
      system:
        "You are a goal-planning agent for a business operating system. Turn the user's goal into a concise ORDERED plan of 3–6 concrete steps a workspace agent could take. " +
        "Each step: a short imperative title, a one-line detail, and a risk_level — 'high' for anything that sends money/external email or deletes data, 'medium' for outbound drafts or bulk changes, 'low' for internal/reversible actions (create a task, flag for review, update a field, draft a note). " +
        "Ground every step in realistic business actions. NEVER invent specific names, amounts, or data — describe the action, not fabricated specifics." +
        (guidance ? `\n\n${guidance}` : ""),
      prompt: `Goal: "${goal}"${agent_name ? ` — assigned agent: ${agent_name}` : ""}. Produce the ordered step plan.`,
      toolName: "record_plan",
      toolDescription: "Record the ordered plan of steps for the goal.",
      toolSchema: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
                risk_level: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["title", "risk_level"],
            },
          },
        },
        required: ["steps"],
      },
      maxTokens: 700, workspaceId: c.get("workspaceId"), userId: c.get("userId"), feature: "goal_plan", taskClass: "reasoning",
    });
    const raw = Array.isArray((result as { steps?: unknown[] }).steps) ? (result as { steps: Record<string, unknown>[] }).steps : [];
    const steps = raw.slice(0, 6).map((s, i) => ({
      order: i + 1,
      title: String(s.title ?? `Step ${i + 1}`).slice(0, 160),
      detail: String(s.detail ?? "").slice(0, 300),
      risk_level: ["low", "medium", "high"].includes(String(s.risk_level)) ? String(s.risk_level) : "medium",
    }));
    if (!steps.length) return c.json({ error: "Couldn't produce a plan for that goal — try rephrasing." }, 200);
    return c.json({ goal, agent_name: agent_name ?? "planner", steps });
  } catch (e) {
    // Be honest about WHY it failed. Out-of-credits is not a transient error — say so, don't
    // tell the user to "try again". Anything else is a real service hiccup; log it for triage.
    if (e instanceof CreditsExhaustedError) return c.json({ error: e.message }, 402);
    console.error("[plan-goal] planning failed:", e);
    return c.json({ error: "The AI planner is temporarily unavailable — please try again in a moment." }, 503);
  }
});

// Dispatch a planned goal AS A TRACKABLE UNIT: persist the goal (a `goal` node) and create one
// decision per step, each linked back to the goal, so progress is measurable (vs the old approach
// of firing N unlinked decisions the user could never reconcile against the goal). Steps still route
// through the queue + autonomy — nothing auto-executes beyond the workspace's own risk band.
const dispatchPlanSchema = z.object({
  goal: z.string().min(1).max(500),
  agent_name: z.string().max(60).optional(),
  steps: z.array(z.object({
    order: z.number().int().optional(),
    title: z.string().min(1).max(200),
    detail: z.string().max(400).optional(),
    risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  })).min(1).max(10),
});
router.post("/dispatch-plan", zValidator("json", dispatchPlanSchema), async (c) => {
  const { goal, agent_name, steps } = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  // 1) Persist the goal itself so its steps can be reconciled against it.
  const { data: goalNode, error: goalErr } = await supabase.from("nodes").insert({
    workspace_id: workspaceId, vertical: "shared", object_type: "goal", created_by: userId,
    data: { title: goal, agent_name: agent_name ?? "planner", total_steps: steps.length, status: "active", created_at: new Date().toISOString() },
  }).select("id").single();
  if (goalErr || !goalNode) return c.json({ error: goalErr?.message ?? "Couldn't create the goal." }, 400);

  // 2) One decision per step, linked to the goal (source_id) + ordered, then run autonomy on each.
  let dispatched = 0;
  const ordered = steps.map((s, i) => ({ ...s, order: s.order ?? i + 1 })).sort((a, b) => a.order - b.order);
  for (const s of ordered) {
    const { data: d } = await supabase.from("decision_queue").insert({
      workspace_id: workspaceId, source_type: "goal_step", source_id: goalNode.id, agent_name: agent_name ?? "planner",
      title: s.title, summary: s.detail || `Goal: ${goal}`, recommended_action: s.title, risk_level: s.risk_level,
      evidence: [{ type: "goal", title: goal, node_id: goalNode.id, match_reason: `Step ${s.order} of ${steps.length}`, goal_step: s.order }],
    }).select("*").single().then((r) => r, () => ({ data: null }));
    if (!d) continue;
    await maybeAutoApprove(workspaceId, d);
    dispatched++;
  }
  return c.json({ goal_id: goalNode.id, dispatched, total: steps.length }, 201);
});

// Active/recent goals with REAL progress computed from their linked step-decisions.
router.get("/goals", async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data: goals } = await supabase.from("nodes")
    .select("id, data, created_at").eq("workspace_id", workspaceId).eq("object_type", "goal")
    .order("created_at", { ascending: false }).limit(25);
  if (!goals?.length) return c.json({ goals: [] });
  const ids = goals.map((g) => g.id);
  const { data: steps } = await supabase.from("decision_queue")
    .select("source_id, status").eq("workspace_id", workspaceId).eq("source_type", "goal_step").in("source_id", ids);
  const agg = new Map<string, { done: number; rejected: number; pending: number; total: number }>();
  for (const s of steps ?? []) {
    const k = String(s.source_id);
    const e = agg.get(k) ?? { done: 0, rejected: 0, pending: 0, total: 0 };
    e.total++;
    const st = String(s.status);
    if (st === "rejected") e.rejected++;
    // `snoozed` is still OUTSTANDING work. It used to fall into the else branch and count as
    // done, so snoozing every step of a goal reported that goal 100% complete.
    else if (st === "pending" || st === "snoozed") e.pending++;
    else e.done++; // approved / executed / completed
    agg.set(k, e);
  }
  const out = goals.map((g) => {
    const d = (g.data ?? {}) as Record<string, unknown>;
    const a = agg.get(g.id) ?? { done: 0, rejected: 0, pending: 0, total: 0 };
    // Denominator is the goal's RECORDED total_steps (authoritative), not the count of surviving
    // step-decisions — a partial dispatch would otherwise shrink the denominator and flip progress/
    // complete prematurely.
    const total = Number(d.total_steps ?? 0) || a.done + a.rejected + a.pending;
    const resolved = a.done + a.rejected;
    const complete = total > 0 && resolved >= total;
    return {
      id: g.id, title: String(d.title ?? "Goal"), agent_name: String(d.agent_name ?? "planner"),
      created_at: g.created_at, total, done: a.done, rejected: a.rejected, pending: a.pending,
      progress: total > 0 ? Math.round((a.done / total) * 100) : 0, status: complete ? "complete" : "active",
    };
  });
  return c.json({ goals: out });
});

// Registered AFTER all literal routes (/autonomy, /agent-scorecard, /plan-goal) so those
// static paths win over this :id param route in Hono's matcher.
router.get("/:id", async (c) => {
  const { data, error } = await supabase
    .from("decision_queue")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: "Decision not found" }, 404);
  return c.json(data);
});

router.post("/", zValidator("json", createSchema), async (c) => {
  const body = c.req.valid("json");
  const workspaceId = c.get("workspaceId");
  const { data, error } = await supabase
    .from("decision_queue")
    .insert({ ...body, workspace_id: workspaceId })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);

  // Autonomy: if the workspace opted in and this decision is within the allowed risk band,
  // execute the real action and mark it approved immediately — no human wait. Fully audited.
  if (await maybeAutoApprove(workspaceId, data)) {
    const { data: resolved } = await supabase.from("decision_queue")
      .select("*").eq("workspace_id", workspaceId).eq("id", data.id).single();
    return c.json(resolved ?? { ...data, status: "approved" }, 201);
  }
  return c.json(data, 201);
});

router.patch("/:id", zValidator("json", createSchema.partial()), async (c) => {
  const body = c.req.valid("json");
  const { data, error } = await supabase
    .from("decision_queue")
    .update(body)
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    // Only resolve something still OPEN. Without this the single-item routes were not
    // idempotent (the bulk routes always guarded): a second approve re-ran the side effect,
    // and a snooze could pull an already-approved-and-executed decision back into the queue,
    // overwriting resolved_at/resolved_by. Terminal states are now terminal.
    .in("status", ["pending", "snoozed"])
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  // Training ledger — a human manually edited the agent's recommendation; record
  // the edit. Fire-and-forget: the recorder swallows its own errors, so detaching
  // it keeps the approve/edit response at zero added latency.
  void logDecisionTrainingExample(c.get("workspaceId"), data, "EDITED", body);
  return c.json(data);
});

async function resolve(c: any, status: "approved" | "rejected" | "snoozed" | "completed", extra: Record<string, unknown> = {}, trainingAction?: TrainingAction) {
  const { data, error } = await supabase
    .from("decision_queue")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: c.get("userId"),
      ...extra,
    })
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    // Terminal decisions stay terminal. The guard belongs HERE, not on individual handlers: it was
    // originally added to /approve only, so /reject and /snooze could still overwrite an
    // already-executed decision — and snoozing one pulled it back into the pending queue.
    .in("status", OPEN_STATUSES)
    .select()
    .maybeSingle();
  if (error) return c.json({ error: error.message }, 400);
  // No row matched → already resolved (or gone). Idempotent success, never a phantom write.
  if (!data) return c.json({ ok: true, already_resolved: true });
  // Training ledger — capture the human's verdict on this agent recommendation.
  // Fire-and-forget: self-contained + error-swallowing, so it adds no latency to
  // (and can never block) the user's action.
  if (trainingAction) void logDecisionTrainingExample(c.get("workspaceId"), data, trainingAction);
  await supabase.from("activities").insert({
    node_id: data.source_id ?? null,
    workspace_id: c.get("workspaceId"),
    actor_type: "human",
    actor_id: c.get("userId"),
    action: `decision_${status}`,
    diff: { decision_id: data.id, title: data.title },
  }).then(() => {}, () => {}); // best-effort — don't fail the request if activity logging fails
  return c.json(data);
}

/**
 * Real action execution on approval — only wired for decision kinds that
 * actually have an automatable action behind them. Everything else (e.g.
 * "reach out to a stale relationship") is advisory; approving it just
 * records the human decision, since there's nothing to execute.
 */
// Outbound agent email (invoice chaser, workflow, …) goes through the shared
// sender: the workspace's connected Gmail inbox first, Resend as fallback.

/** Find a usable recipient email on a record (or its common contact fields). */
function emailFromRecord(data: Record<string, any> | null | undefined): { email: string; name?: string } | undefined {
  if (!data) return undefined;
  const email = data.email ?? data.client_email ?? data.contact_email ?? data.Email ?? data.to_email;
  if (typeof email === "string" && /.+@.+\..+/.test(email)) {
    return { email, name: data.name ?? data.client_name ?? data.contact_name ?? undefined };
  }
  return undefined;
}

/** When we can't safely auto-send (no Nylas grant, or no clear recipient), drop
 *  the drafted email into a task so a human can send it — never silently lose it. */
async function emailFallbackTask(workspaceId: string, createdBy: string, title: string, subject: string, body: string): Promise<void> {
  await supabase.from("nodes").insert({
    workspace_id: workspaceId, vertical: "shared", object_type: "task", created_by: createdBy,
    data: { title, notes: `Approved — send manually:\n\nSubject: ${subject}\n\n${body}`, status: "todo", priority: "medium" },
  });
}

export async function executeApprovedAction(workspaceId: string, decision: any): Promise<void> {
  // Meeting-agent follow-up: approving a call action item creates a real task (assigned to the
  // meeting's owner, linked back to the call record).
  if (decision.source_type === "meeting_action") {
    const title = String(decision.recommended_action || decision.title || "").slice(0, 200);
    if (!title) return;
    const callId = decision.source_id as string | undefined;
    let owner: string | null = null;
    if (callId) {
      const { data: callNode } = await supabase.from("nodes").select("created_by").eq("id", callId).eq("workspace_id", workspaceId).maybeSingle();
      owner = (callNode?.created_by as string) ?? null;
    }
    await supabase.from("tasks").insert({
      workspace_id: workspaceId, title, assignee_id: owner, completed: false, priority: "medium", status: "todo",
      ...(callId ? { record_id: callId } : {}),
    }).then(() => {}, () => {});
    return;
  }
  if (decision.agent_name === "prospecting" && decision.source_type === "prospecting_candidate") {
    const evidenceItem = (decision.evidence ?? [])[0] as { candidate?: ProspectCandidate; destination_list_id?: string | null } | undefined;
    const candidate = evidenceItem?.candidate;
    if (!candidate) return;

    const node = await ubc.createNode({
      workspace_id: workspaceId,
      vertical: objectTypeToVertical(candidate.object_type),
      object_type: candidate.object_type,
      created_by: "agent:prospecting",
      data: {
        name: candidate.name,
        email: candidate.email ?? undefined,
        domain: candidate.domain ?? undefined,
        website: candidate.website ?? undefined,
        linkedin: candidate.linkedin ?? undefined,
        description: candidate.description ?? undefined,
        location: candidate.location ?? undefined,
        source_url: candidate.source_url,
        source_title: candidate.source_title,
        confidence_label: candidate.confidence_label,
      },
    });
    await ubc.logActivity(node.id!, workspaceId, "ai_agent", "prospecting", "created", undefined, `Approved from Decision Queue: ${candidate.reason}`);
    inngest.send({
      name: "crm/record.created",
      data: { workspaceId, nodeId: node.id!, objectType: candidate.object_type, vertical: objectTypeToVertical(candidate.object_type) },
    }).catch((e) => console.error("[bg-task] swallowed error:", e));

    if (evidenceItem?.destination_list_id) {
      const { count } = await supabase.from("list_entries").select("*", { count: "exact", head: true }).eq("list_id", evidenceItem.destination_list_id);
      await supabase.from("list_entries").upsert({ list_id: evidenceItem.destination_list_id, node_id: node.id, position: (count ?? 0) + 1 });
    }
    return;
  }

  // Discovery Agent: approving a discovered lead creates a real, agent-marked person/lead record.
  if (decision.agent_name === "discovery" && decision.source_type === "discovered_lead") {
    const lead = ((decision.evidence ?? [])[0] as { lead?: Record<string, any> } | undefined)?.lead;
    if (!lead?.name && !lead?.email) return;

    // ── DEDUP BEFORE CREATE ──
    // This path created a person node unconditionally. The Discovery monitor cron re-runs every 4
    // hours (vercel.json: "0 */4 * * *"), rediscovers the SAME leads, and with autonomy enabled the
    // resulting decisions auto-approve — so each run minted another copy. Measured on the owner
    // workspace: 588 `person` records for 136 distinct entities, 452 of them duplicates, with the
    // worst offenders appearing exactly 18 times on a clean 4-hour cadence.
    //
    // source_url is the lead's identity (the page it came from); email is the fallback for leads
    // without one. Name alone is NOT used — different businesses legitimately share a name.
    const dedupKey = lead.source_url ? "source_url" : lead.email ? "email" : null;
    const dedupVal = lead.source_url ?? lead.email;
    if (dedupKey && dedupVal) {
      const { data: existing } = await supabase
        .from("nodes").select("id")
        .eq("workspace_id", workspaceId).eq("object_type", "person")
        .eq(`data->>${dedupKey}`, String(dedupVal))
        .limit(1);
      if (existing && existing.length > 0) {
        console.info(`[discovery] lead already exists (${dedupKey}=${dedupVal}) — skipping duplicate create`);
        return;
      }
    }

    const node = await ubc.createNode({
      workspace_id: workspaceId,
      vertical: "sales",
      object_type: "person",
      created_by: "agent:discovery",   // agent-icon marking in the UI
      data: {
        name: lead.name || lead.email || "Discovered lead",
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        twitter: lead.handle ?? undefined,
        notes: lead.summary ?? undefined,
        region: lead.region ?? undefined,
        source_url: lead.source_url ?? undefined,
        discovered: true,
      },
    });
    await ubc.logActivity(node.id!, workspaceId, "ai_agent", "discovery", "created", undefined, "Approved from Decision Queue (Discovery)");
    inngest.send({ name: "crm/record.created", data: { workspaceId, nodeId: node.id!, objectType: "person", vertical: "sales" } }).catch(() => {});
    return;
  }

  if (decision.agent_name === "invoice_chaser" && decision.source_type === "invoice") {
    const { data: invoice } = await supabase
      .from("nodes")
      .select("id, data")
      .eq("id", decision.source_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!invoice) return;
    const invoiceData = invoice.data as Record<string, any>;
    const clientEmail = invoiceData.client_email as string | undefined;
    const subject = String(decision.recommended_action ?? "").replace(/^Send: "(.+)"$/, "$1") || `Invoice ${invoiceData.invoice_number ?? invoice.id} reminder`;
    const body = decision.summary ?? "";
    const chaseCount = (invoiceData.chase_count ?? 0) + 1;

    if (clientEmail) {
      const sent = await sendWorkspaceEmail(workspaceId, { subject, body, to: [{ email: clientEmail, name: invoiceData.client_name ?? clientEmail }] });
      if (!sent) {
        await emailFallbackTask(workspaceId, "agent:invoice_chaser", `Chase invoice ${invoiceData.invoice_number ?? invoice.id}`, subject, body);
      }
    }

    await supabase.from("nodes").update({
      data: { ...invoiceData, status: "overdue", last_chased_at: new Date().toISOString(), chase_count: chaseCount },
    }).eq("id", invoice.id);
    return;
  }

  // Workflow Agent — an approved email action (e.g. a Deal-Won congratulations
  // email) flows out of the user's connected inbox via Nylas. We only auto-send
  // when there's a clear recipient on the linked record AND a connected inbox;
  // otherwise the draft becomes a task so it's never sent to the wrong person
  // or silently dropped.
  if (decision.agent_name === "workflow") {
    const subject = String(decision.title ?? "Workflow email").replace(/^Workflow:\s*/i, "") || "Workflow email";
    const body = String(decision.summary ?? decision.recommended_action ?? "");
    let recipient: { email: string; name?: string } | undefined;
    if (decision.source_id) {
      const { data: rec } = await supabase
        .from("nodes").select("data").eq("id", decision.source_id).eq("workspace_id", workspaceId).maybeSingle();
      recipient = emailFromRecord(rec?.data as Record<string, any> | undefined);
    }
    if (recipient) {
      const sent = await sendWorkspaceEmail(workspaceId, { subject, body, to: [recipient] });
      if (!sent) await emailFallbackTask(workspaceId, "agent:workflow", `Send: ${subject}`, subject, body);
    } else {
      // No clear recipient — hand it to a human rather than guess.
      await emailFallbackTask(workspaceId, "agent:workflow", `Send: ${subject}`, subject, body);
    }
    return;
  }
}

router.post("/:id/approve", async (c) => {
  const { data: decision } = await supabase
    .from("decision_queue")
    .select("*")
    .eq("workspace_id", c.get("workspaceId"))
    .eq("id", c.req.param("id"))
    .maybeSingle();
  // Guard the SIDE EFFECT too, not just the row update: re-approving used to re-send the
  // invoice chase email, re-create the prospect record and re-increment chase_count.
  if (!decision) return c.json({ error: "Not found" }, 404);
  if (!["pending", "snoozed"].includes(String(decision.status ?? ""))) {
    return c.json({ ok: true, already: decision.status });
  }
  await executeApprovedAction(c.get("workspaceId"), decision).catch((e) => console.error("[bg-task] swallowed error:", e));
  return resolve(c, "approved", {}, "APPROVED");
});
router.post("/:id/reject", async (c) => resolve(c, "rejected", {}, "REJECTED"));
router.post("/:id/snooze", zValidator("json", z.object({ until: z.string().optional() }).optional()), async (c) => {
  const body = c.req.valid("json") ?? {};
  const until = body.until ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return resolve(c, "snoozed", { snoozed_until: until });
});

// Bulk resolve — clear a whole group at once (the queue had 300+ pending items with no way
// to triage in bulk). Approve executes each decision's real action; reject/snooze just resolve.
router.post("/bulk", zValidator("json", z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["approve", "reject", "snooze"]),
})), async (c) => {
  const { ids, action } = c.req.valid("json");
  const ws = c.get("workspaceId");
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "snoozed";
  const extra = action === "snooze" ? { snoozed_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {};
  if (action === "approve") {
    const { data: decisions } = await supabase.from("decision_queue").select("*").eq("workspace_id", ws).in("id", ids).in("status", OPEN_STATUSES);
    for (const d of decisions ?? []) await executeApprovedAction(ws, d).catch((e) => console.error("[bulk-approve] swallowed:", e));
  }
  const { data, error } = await supabase.from("decision_queue")
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: c.get("userId"), ...extra })
    // Same open-set as the single-item routes: filtering to "pending" alone silently skipped
    // snoozed rows, so a bulk action reported a lower count than the user actually selected.
    .eq("workspace_id", ws).in("id", ids).in("status", OPEN_STATUSES).select("id");
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true, count: data?.length ?? 0 });
});

/**
 * Grounded per-decision Ask — "explain this", "what happens if I approve?", "show evidence".
 * Uses ONLY the decision's own real fields (title, summary, recommended_action, risk, confidence,
 * evidence, generation_context, execution preview). No tools, no invented facts. Refuses when the
 * decision has no substance to ground on. Workspace-scoped.
 */
router.post("/:id/ask", async (c) => {
  const workspaceId = c.get("workspaceId");
  const body = await c.req.json().catch(() => ({})) as { question?: string };
  const question = (body.question ?? "").trim() || "Explain this decision.";

  const { data: d } = await supabase
    .from("decision_queue").select("*").eq("workspace_id", workspaceId).eq("id", c.req.param("id")).maybeSingle();
  if (!d) return c.json({ answer: "That decision no longer exists.", sources: [], sufficient: false }, 404);

  const evidence = Array.isArray(d.evidence) ? d.evidence : [];
  const exec = describeExecution(d);
  const gen = (d.generation_context ?? null) as { user_prompt?: string; model_output?: unknown } | null;

  // Nothing to ground on → refuse rather than invent.
  const hasSubstance = Boolean(d.summary || d.recommended_action || evidence.length || gen?.user_prompt);
  if (!hasSubstance) {
    return c.json({ answer: "I don't have enough recorded detail on this decision to explain it.", sources: [], sufficient: false });
  }

  const evidenceLines = evidence.slice(0, 12).map((e: Record<string, unknown>, i: number) =>
    `  ${i + 1}. ${e.title ?? "evidence"}${e.match_reason ? ` — ${e.match_reason}` : e.relationship ? ` — ${e.relationship}` : ""}`);
  const digest = [
    `Decision: ${d.title}`,
    `Raised by agent: ${d.agent_name}. Source type: ${d.source_type}. Risk: ${d.risk_level}.`,
    d.confidence != null ? `Confidence (real, computed): ${d.confidence}%.` : "Confidence: not computed (source-backed, no number).",
    d.summary ? `Why it was raised: ${d.summary}` : "",
    d.recommended_action ? `Recommended action: ${d.recommended_action}` : "",
    `Exactly what approving does: ${exec.text}`,
    evidenceLines.length ? `Evidence:\n${evidenceLines.join("\n")}` : "Evidence: none recorded.",
    gen?.user_prompt ? `Original AI context: ${String(gen.user_prompt).slice(0, 1500)}` : "",
  ].filter(Boolean).join("\n");

  const system =
    "You are a workspace approval assistant. Answer the admin's question about ONE decision using ONLY the data provided. " +
    "Never invent evidence, numbers, confidence, or consequences. If confidence is 'not computed', do NOT make one up. " +
    "Be concise and factual (2-5 sentences). Do NOT mention tools, prompts, or your reasoning process. " +
    "If the data doesn't answer the question, say so plainly.";

  const sources = evidence.slice(0, 12).map((e: Record<string, unknown>) => ({ type: "evidence" as const, title: String(e.title ?? "evidence"), relevance: (e.match_reason ?? e.relationship) as string | undefined }));
  try {
    const { text } = await aiGateway({ system, prompt: `Question: ${question}\n\nData:\n${digest}`, maxTokens: 320, workspaceId, userId: c.get("userId"), feature: "decision_ask", taskClass: "reasoning" });
    const answer = (text || "").trim();
    return c.json({ answer: answer || "I couldn't produce an explanation for this decision.", sources, sufficient: true });
  } catch {
    return c.json({ answer: "The AI service is unavailable right now — please try again in a moment.", sources, sufficient: true });
  }
});

/**
 * POST /:id/verdict — structured AI adjudication of ONE decision, grounded strictly on the
 * recorded data (summary, evidence, execution preview, original generation context). Returns a
 * recommendation + rationale + risks + what the admin should verify. HONEST: with nothing
 * recorded to ground on it returns sufficient:false instead of inventing a verdict; when the
 * evidence is thin the model is instructed to say "investigate", never a confident approve.
 */
router.post("/:id/verdict", async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data: d } = await supabase
    .from("decision_queue").select("*").eq("workspace_id", workspaceId).eq("id", c.req.param("id")).maybeSingle();
  if (!d) return c.json({ error: "Decision not found" }, 404);

  const evidence = Array.isArray(d.evidence) ? d.evidence : [];
  const exec = describeExecution(d);
  const gen = (d.generation_context ?? null) as { user_prompt?: string; model_output?: unknown } | null;
  const hasSubstance = Boolean(d.summary || d.recommended_action || evidence.length || gen?.user_prompt);
  if (!hasSubstance) return c.json({ sufficient: false, reason: "This decision has no recorded summary, evidence, or context to adjudicate on." });

  const evidenceLines = evidence.slice(0, 12).map((e: Record<string, unknown>, i: number) =>
    `  ${i + 1}. ${e.title ?? "evidence"}${e.match_reason ? ` — ${e.match_reason}` : e.relationship ? ` — ${e.relationship}` : ""}`);
  const digest = [
    `Decision: ${d.title}`,
    `Raised by agent: ${d.agent_name}. Source type: ${d.source_type}. Risk level: ${d.risk_level}.`,
    d.confidence != null ? `Computed confidence: ${d.confidence}%.` : "Confidence: not computed.",
    d.summary ? `Why it was raised: ${d.summary}` : "",
    d.recommended_action ? `Recommended action: ${d.recommended_action}` : "",
    `Exactly what approving does: ${exec.text}`,
    evidenceLines.length ? `Evidence (${evidence.length} item(s)):\n${evidenceLines.join("\n")}` : "Evidence: none recorded.",
    gen?.user_prompt ? `Original AI context (what the agent saw): ${String(gen.user_prompt).slice(0, 1500)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const result = await aiGatewayToolUse({
      system:
        "You are an adjudication assistant for a human approval queue. Judge ONE agent-raised decision using ONLY the data provided. " +
        "Rules: never invent evidence, numbers, or consequences. If the evidence is thin, contradictory, or the action is irreversible with weak support, recommend 'investigate' — NEVER a confident approve. " +
        "'risks' = concrete downsides of approving that are visible in the data. 'checks' = specific things the human should verify before acting. Keep every field short and factual.",
      prompt: `Adjudicate this decision:\n\n${digest}`,
      toolName: "record_verdict",
      toolDescription: "Record the structured adjudication of the decision.",
      toolSchema: {
        type: "object",
        properties: {
          recommendation: { type: "string", enum: ["approve", "reject", "investigate"] },
          rationale: { type: "string", description: "2-3 factual sentences grounded in the provided data." },
          risks: { type: "array", items: { type: "string" }, description: "Concrete downsides of approving, from the data only." },
          checks: { type: "array", items: { type: "string" }, description: "What the human should verify before acting." },
        },
        required: ["recommendation", "rationale"],
      },
      maxTokens: 500,
      workspaceId,
      userId: c.get("userId"),
      feature: "decision_verdict", taskClass: "reasoning",
    });
    const r = (result ?? {}) as { recommendation?: string; rationale?: string; risks?: string[]; checks?: string[] };
    const rec = ["approve", "reject", "investigate"].includes(String(r.recommendation)) ? String(r.recommendation) : "investigate";
    return c.json({
      sufficient: true,
      recommendation: rec,
      rationale: String(r.rationale ?? "").slice(0, 1000),
      risks: (Array.isArray(r.risks) ? r.risks : []).slice(0, 5).map(String),
      checks: (Array.isArray(r.checks) ? r.checks : []).slice(0, 5).map(String),
      grounded_on: {
        evidence_count: evidence.length,
        has_summary: Boolean(d.summary),
        has_agent_context: Boolean(gen?.user_prompt),
        execution_preview: exec.text,
      },
    });
  } catch {
    return c.json({ error: "The AI service is unavailable right now — please try again." }, 503);
  }
});

/**
 * POST /triage — AI ranking of the PENDING queue: which decisions deserve attention first and
 * why, grounded only on each row's recorded fields. Pure read (ranks, never acts); returned ids
 * are validated against the real queue so the model can't inject phantom decisions.
 */
router.post("/triage", async (c) => {
  const workspaceId = c.get("workspaceId");
  const { data: rows } = await supabase
    .from("decision_queue")
    .select("id, title, summary, agent_name, source_type, risk_level, confidence, evidence, created_at")
    .eq("workspace_id", workspaceId).eq("status", "pending")
    .order("created_at", { ascending: true }).limit(30);
  const pending = rows ?? [];
  if (pending.length === 0) return c.json({ sufficient: false, reason: "No pending decisions to triage." });
  if (pending.length === 1) return c.json({ sufficient: true, ranked: [{ id: pending[0]!.id, priority: "high", reason: "Only pending decision." }] });

  const lines = pending.map((d, i) => {
    const ev = Array.isArray(d.evidence) ? d.evidence.length : 0;
    const age = Math.round((Date.now() - new Date(d.created_at).getTime()) / 86_400_000);
    return `${i + 1}. id=${d.id} · "${d.title}" · agent=${d.agent_name} · risk=${d.risk_level} · evidence=${ev} · age=${age}d${d.summary ? ` · ${String(d.summary).slice(0, 140)}` : ""}`;
  });

  try {
    const result = await aiGatewayToolUse({
      system:
        "You triage a human approval queue. Rank the given decisions by where the human's attention creates the most value NOW. " +
        "Consider real risk level, evidence strength, age, and stated impact — from the provided lines ONLY. Give each a one-line factual reason. " +
        "Use ONLY the ids provided; include every id exactly once.",
      prompt: `Rank these ${pending.length} pending decisions:\n\n${lines.join("\n")}`,
      toolName: "record_triage",
      toolDescription: "Record the triage ranking of the pending decisions.",
      toolSchema: {
        type: "object",
        properties: {
          ranked: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                reason: { type: "string" },
              },
              required: ["id", "priority", "reason"],
            },
          },
        },
        required: ["ranked"],
      },
      maxTokens: 900,
      workspaceId,
      userId: c.get("userId"),
      feature: "decision_triage", taskClass: "reasoning",
    });
    const validIds = new Set(pending.map((d) => String(d.id)));
    const seen = new Set<string>();
    const ranked = (Array.isArray((result as { ranked?: unknown[] }).ranked) ? (result as { ranked: Record<string, unknown>[] }).ranked : [])
      .filter((r) => validIds.has(String(r.id)) && !seen.has(String(r.id)) && seen.add(String(r.id)))
      .map((r) => ({
        id: String(r.id),
        priority: ["high", "medium", "low"].includes(String(r.priority)) ? String(r.priority) : "medium",
        reason: String(r.reason ?? "").slice(0, 200),
      }));
    // Anything the model dropped keeps its place at the end, honestly unranked.
    for (const d of pending) if (!seen.has(String(d.id))) ranked.push({ id: String(d.id), priority: "medium", reason: "Not ranked by AI — review manually." });
    return c.json({ sufficient: true, ranked });
  } catch {
    return c.json({ error: "The AI service is unavailable right now — please try again." }, 503);
  }
});

/** Confirm a decision belongs to this workspace before touching its children (comments/assignee). */
async function decisionInWorkspace(workspaceId: string, id: string): Promise<{ id: string; assignee_id: string | null; title: string } | null> {
  const { data } = await supabase.from("decision_queue").select("id, assignee_id, title").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  return data as { id: string; assignee_id: string | null; title: string } | null;
}

/** GET /:id/comments — threaded comments for a decision (workspace-scoped). */
router.get("/:id/comments", async (c) => {
  const workspaceId = c.get("workspaceId");
  const id = c.req.param("id");
  if (!(await decisionInWorkspace(workspaceId, id))) return c.json({ error: "Decision not found" }, 404);
  const { data, error } = await supabase
    .from("decision_comments")
    .select("id, author_id, author_name, body, created_at")
    .eq("workspace_id", workspaceId).eq("decision_id", id)
    .order("created_at", { ascending: true }).limit(500);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data ?? []);
});

/** POST /:id/comments — add a comment. Notifies the assignee (if any and not the author). */
router.post("/:id/comments", zValidator("json", z.object({ body: z.string().min(1).max(5000) })), async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const id = c.req.param("id");
  const decision = await decisionInWorkspace(workspaceId, id);
  if (!decision) return c.json({ error: "Decision not found" }, 404);
  const { body } = c.req.valid("json");

  const { data: me } = await supabase.from("workspace_members").select("name, email").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
  const authorName = (me?.name as string) || (me?.email as string) || "A member";

  const { data, error } = await supabase.from("decision_comments").insert({
    workspace_id: workspaceId, decision_id: id, author_id: userId, author_name: authorName, body,
  }).select("id, author_id, author_name, body, created_at").single();
  if (error) return c.json({ error: error.message }, 500);

  // Notify the assignee (deep-links to the decision) — never the author, never fabricated.
  if (decision.assignee_id && decision.assignee_id !== userId) {
    await createNotification({
      workspace_id: workspaceId, user_id: decision.assignee_id, type: "decision",
      title: "New comment on a decision you're reviewing",
      body: `${authorName} commented on "${decision.title}".`,
      source: { decision_id: id, route: `/decisions?id=${id}` },
    }).catch(() => {});
  }
  return c.json(data, 201);
});

/** POST /:id/assign — assign or unassign a reviewer. Body: { assignee_id, assignee_email? } or
 *  { assignee_id: null } to clear. Notifies the newly-assigned reviewer. */
router.post("/:id/assign", zValidator("json", z.object({
  assignee_id: z.string().nullable(),
  assignee_email: z.string().email().optional().nullable(),
})), async (c) => {
  const workspaceId = c.get("workspaceId");
  const userId = c.get("userId");
  const id = c.req.param("id");
  const decision = await decisionInWorkspace(workspaceId, id);
  if (!decision) return c.json({ error: "Decision not found" }, 404);
  const { assignee_id, assignee_email } = c.req.valid("json");

  const { data, error } = await supabase.from("decision_queue")
    .update({ assignee_id, assignee_email: assignee_id ? (assignee_email ?? null) : null })
    .eq("workspace_id", workspaceId).eq("id", id)
    .select("*").single();
  if (error) return c.json({ error: error.message }, 400);

  // Notify the assignee when newly assigned to someone other than themselves.
  if (assignee_id && assignee_id !== userId && assignee_id !== decision.assignee_id) {
    await createNotification({
      workspace_id: workspaceId, user_id: assignee_id, type: "decision",
      title: "You were assigned a decision to review",
      body: `"${decision.title}" is now assigned to you.`,
      source: { decision_id: id, route: `/decisions?id=${id}` },
    }).catch(() => {});
  }
  return c.json(withPreview(data));
});

export { router as decisionsRouter };
