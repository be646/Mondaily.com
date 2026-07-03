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
