/**
 * Team-intelligence work-quality signals — derived ONLY from real per-member metrics that the
 * oversight-matrix already computes from the database. Every signal is source-backed: `basis`
 * states the exact real numbers behind it. When the inputs are absent/zero, the signal is
 * "insufficient" rather than a fabricated score — we never invent a productivity number.
 *
 * Pure + exported so the calculation is unit-tested and reused server-side (the endpoint attaches
 * the result to each operator; the frontend only renders it).
 */

export type SignalLevel = "good" | "watch" | "risk" | "insufficient";

export interface WorkQualitySignal {
  key: "follow_up" | "overdue_risk" | "consistency" | "decisions" | "handoff";
  label: string;
  level: SignalLevel;
  /** Source-backed one-line explanation citing the real numbers. */
  basis: string;
}

/** The real per-operator metrics this calculation reads (subset of the oversight-matrix operator). */
export interface OperatorMetrics {
  open_tasks: number;
  overdue_tasks: number;
  completed_tasks: number;
  task_count: number;          // human activity events in the 30d window
  decisions_resolved: number;  // decision_queue rows this member resolved (30d)
  last_active_at: string | null;
  reassigned_tasks?: number;   // handoffs — not tracked yet (stays undefined)
}

const DAY = 86_400_000;
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY);
}

/**
 * Compute the source-backed work-quality signals for one member. `now` is injectable for
 * deterministic tests. Returns exactly five signals in a stable order.
 */
export function workQuality(op: OperatorMetrics): WorkQualitySignal[] {
  const signals: WorkQualitySignal[] = [];
  const activeTasks = op.open_tasks + op.overdue_tasks;
  const totalTasks = activeTasks + op.completed_tasks;

  // 1) Follow-up discipline — of the tasks that are/were due, how many slipped overdue.
  if (activeTasks === 0) {
    signals.push({ key: "follow_up", label: "Follow-up discipline", level: "insufficient", basis: "No open tasks assigned in scope — nothing to measure." });
  } else {
    const slip = op.overdue_tasks / activeTasks;
    const level: SignalLevel = slip === 0 ? "good" : slip <= 0.34 ? "watch" : "risk";
    signals.push({ key: "follow_up", label: "Follow-up discipline", level, basis: `${op.overdue_tasks} of ${activeTasks} open task(s) are overdue (${Math.round(slip * 100)}%).` });
  }

  // 2) Overdue risk — absolute overdue count.
  {
    const level: SignalLevel = op.overdue_tasks === 0 ? "good" : op.overdue_tasks <= 2 ? "watch" : "risk";
    signals.push({ key: "overdue_risk", label: "Overdue risk", level, basis: `${op.overdue_tasks} overdue task(s) currently assigned.` });
  }

  // 3) Activity consistency — recency + volume of real human activity.
  const d = daysSince(op.last_active_at);
  if (op.task_count === 0 || d === null) {
    signals.push({ key: "consistency", label: "Activity consistency", level: "insufficient", basis: "No tracked activity in the last 30 days." });
  } else {
    const level: SignalLevel = d <= 3 ? "good" : d <= 7 ? "watch" : "risk";
    signals.push({ key: "consistency", label: "Activity consistency", level, basis: `${op.task_count} action(s) in 30d; last active ${d} day(s) ago.` });
  }

  // 4) Decision participation — how many Decision Queue items this member resolved.
  if (op.decisions_resolved === 0) {
    signals.push({ key: "decisions", label: "Decision participation", level: "insufficient", basis: "No decisions resolved in the last 30 days." });
  } else {
    const level: SignalLevel = op.decisions_resolved >= 3 ? "good" : "watch";
    signals.push({ key: "decisions", label: "Decision participation", level, basis: `Resolved ${op.decisions_resolved} decision(s) in 30d.` });
  }

  // 5) Handoff quality — task reassignments are not tracked yet, so we say so honestly.
  if (typeof op.reassigned_tasks !== "number") {
    signals.push({ key: "handoff", label: "Handoff quality", level: "insufficient", basis: "Handoff/reassignment history is not tracked yet." });
  } else {
    const level: SignalLevel = op.reassigned_tasks === 0 ? "good" : op.reassigned_tasks <= 2 ? "watch" : "risk";
    signals.push({ key: "handoff", label: "Handoff quality", level, basis: `${op.reassigned_tasks} task(s) reassigned away.` });
  }

  return signals;
}

// ── Deal / opportunity aggregation (Increment 2) ──────────────────────────────────────────────
// Deals are nodes; ownership lives in `data` (no first-class owner column). We match a member if
// ANY of their identifiers (user_id / email / name, case-insensitive) appears in the deal's owner
// fields or created_by. Exact fields used: data.owner_id, data.owner, data.assignee,
// data.assigned_to, data.rep, data.account_owner, and the node's created_by column.
export interface DealNode { id: string; object_type: string; data: Record<string, unknown>; created_by?: string | null }
export interface MemberRef { user_id: string; email?: string | null; name?: string | null }
export interface DealTally { owned: number; won: number; lost: number; open: number }

const OWNER_FIELDS = ["owner_id", "owner", "assignee", "assigned_to", "rep", "account_owner"];

export function isDealType(objectType: string): boolean {
  const t = (objectType ?? "").toLowerCase();
  return t.includes("deal") || t.includes("opportunit");
}

/** Won / lost / open from the deal's stage-or-status field (same resolution the app uses elsewhere). */
export function dealStageClass(data: Record<string, unknown>): "won" | "lost" | "open" {
  const s = String((data.deal_stage ?? data.stage ?? data.status ?? "")).toLowerCase();
  if (s.includes("won")) return "won";
  if (s.includes("lost")) return "lost";
  return "open";
}

/** The lowercased set of owner identifiers a deal node carries. */
export function dealOwnerKeys(node: DealNode): Set<string> {
  const keys = new Set<string>();
  const add = (v: unknown) => { const s = String(v ?? "").trim().toLowerCase(); if (s) keys.add(s); };
  for (const f of OWNER_FIELDS) add(node.data?.[f]);
  add(node.created_by);
  return keys;
}

/**
 * Per-member deal tallies. A member "owns" a deal if one of their identifiers matches an owner key.
 * Pure + workspace-agnostic (caller passes only this workspace's deal nodes) so it's unit-tested.
 */
export function aggregateDeals(deals: DealNode[], members: MemberRef[]): Map<string, DealTally> {
  const out = new Map<string, DealTally>();
  const memberKeys = members.map(m => ({
    uid: m.user_id,
    ids: new Set([m.user_id, m.email ?? "", m.name ?? ""].map(s => String(s).trim().toLowerCase()).filter(Boolean)),
  }));
  for (const deal of deals) {
    if (!isDealType(deal.object_type)) continue;
    const owners = dealOwnerKeys(deal);
    const cls = dealStageClass(deal.data ?? {});
    for (const m of memberKeys) {
      let matched = false;
      for (const id of m.ids) if (owners.has(id)) { matched = true; break; }
      if (!matched) continue;
      const t = out.get(m.uid) ?? { owned: 0, won: 0, lost: 0, open: 0 };
      t.owned += 1; t[cls] += 1;
      out.set(m.uid, t);
    }
  }
  return out;
}

// ── Daily trend bucketing (Increment 2) ───────────────────────────────────────────────────────
export interface TrendPoint { date: string; value: number }

/**
 * Bucket timestamped items into the last `days` calendar days (UTC), zero-filled, oldest→newest.
 * `nowMs` is injectable for deterministic tests. `value` defaults to 1 (a count).
 */
export function dailyTrend<T>(items: T[], getIso: (t: T) => string | null | undefined, days: number, nowMs: number, value: (t: T) => number = () => 1): TrendPoint[] {
  const DAY = 86_400_000;
  const startOfDay = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const todayStart = startOfDay(nowMs);
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) buckets.set(new Date(todayStart - i * DAY).toISOString().slice(0, 10), 0);
  for (const it of items) {
    const iso = getIso(it);
    if (!iso) continue;
    const key = String(iso).slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + value(it));
  }
  return [...buckets.entries()].map(([date, v]) => ({ date, value: v }));
}

// ── Admin evaluation label (Increment 2) ──────────────────────────────────────────────────────
// A single source-backed headline per member. NOT a productivity score — a label tied to real
// counts, with an honest "Inactive" / basis. Order = priority.
export interface EvalInput { open_tasks: number; overdue_tasks: number; task_count: number; decisions_resolved: number }
export interface EvalLabel { label: string; tone: "good" | "watch" | "risk" | "neutral"; basis: string }

export function evaluationLabel(op: EvalInput): EvalLabel {
  if (op.task_count === 0 && op.open_tasks === 0 && op.decisions_resolved === 0) {
    return { label: "Inactive", tone: "neutral", basis: "No tracked tasks, activity, or decisions in scope." };
  }
  if (op.overdue_tasks >= 3) {
    return { label: "At risk of overdue work", tone: "risk", basis: `${op.overdue_tasks} overdue task(s).` };
  }
  if (op.overdue_tasks > 0) {
    return { label: "Needs follow-up", tone: "watch", basis: `${op.overdue_tasks} overdue of ${op.open_tasks + op.overdue_tasks} open task(s).` };
  }
  if (op.decisions_resolved >= 3) {
    return { label: "Decision contributor", tone: "good", basis: `Resolved ${op.decisions_resolved} decision(s) in 30d.` };
  }
  return { label: "Balanced workload", tone: "good", basis: `${op.open_tasks} open task(s), none overdue.` };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Advanced team intelligence — velocity (real cycle times), collaboration (real message edges),
// and goal attainment. Every function is a PURE aggregation over already-fetched real rows, so it's
// unit-testable and never fabricates: when there's nothing to measure it returns null/empty, not a 0.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface TaskTiming { completed?: boolean | null; completed_at?: string | null; due_date?: string | null; created_at?: string | null }
/** Average task lead time (created → completed, in days) + on-time rate, from REAL completed tasks only. */
export function avgTaskLeadDays(tasks: TaskTiming[]): { avg_days: number | null; on_time_rate: number | null; sample: number } {
  const done = tasks.filter(t => t.completed && t.completed_at && t.created_at);
  if (done.length === 0) return { avg_days: null, on_time_rate: null, sample: 0 };
  let sum = 0, onTime = 0, dueSample = 0;
  for (const t of done) {
    const lead = (new Date(t.completed_at!).getTime() - new Date(t.created_at!).getTime()) / 86_400_000;
    if (Number.isFinite(lead) && lead >= 0) sum += lead;
    if (t.due_date) { dueSample++; if (new Date(t.completed_at!).getTime() <= new Date(t.due_date).getTime()) onTime++; }
  }
  return {
    avg_days: Math.round((sum / done.length) * 10) / 10,
    on_time_rate: dueSample ? Math.round((onTime / dueSample) * 100) : null,
    sample: done.length,
  };
}

export interface DecisionTiming { created_at?: string | null; resolved_at?: string | null }
/** Average decision cycle time (raised → resolved, in hours), from REAL resolved decisions only. */
export function avgDecisionCycleHours(decisions: DecisionTiming[]): { avg_hours: number | null; sample: number } {
  const done = decisions.filter(d => d.resolved_at && d.created_at);
  if (done.length === 0) return { avg_hours: null, sample: 0 };
  let sum = 0;
  for (const d of done) { const h = (new Date(d.resolved_at!).getTime() - new Date(d.created_at!).getTime()) / 3_600_000; if (Number.isFinite(h) && h >= 0) sum += h; }
  return { avg_hours: Math.round((sum / done.length) * 10) / 10, sample: done.length };
}

export interface MsgEdge { sender_id?: string | null; recipient_id?: string | null }
/** Directed collaboration edges (sender → recipient) with real message counts, busiest first. Self-messages dropped. */
export function collaborationEdges(msgs: MsgEdge[]): { from: string; to: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of msgs) {
    const a = String(x.sender_id ?? ""), b = String(x.recipient_id ?? "");
    if (!a || !b || a === b) continue;
    m.set(`${a} ${b}`, (m.get(`${a} ${b}`) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([k, count]) => { const [from, to] = k.split(" "); return { from: from!, to: to!, count }; })
    .sort((x, y) => y.count - x.count);
}

// The REAL metrics a goal can target — each maps 1:1 to an oversight-matrix per-member field.
export const GOAL_METRICS = ["tasks_completed", "decisions_resolved", "deals_won", "records_touched", "ai_credits"] as const;
export type GoalMetric = typeof GOAL_METRICS[number];
export const GOAL_METRIC_LABEL: Record<GoalMetric, string> = {
  tasks_completed: "Tasks completed",
  decisions_resolved: "Decisions resolved",
  deals_won: "Deals won",
  records_touched: "Records touched",
  ai_credits: "AI credits",
};
export function isGoalMetric(v: unknown): v is GoalMetric {
  return typeof v === "string" && (GOAL_METRICS as readonly string[]).includes(v);
}
/** Attainment as a clamped 0–100 percentage of a real actual against a positive target. */
export function goalAttainmentPct(actual: number, target: number): number {
  if (!(target > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((actual / target) * 100)));
}

