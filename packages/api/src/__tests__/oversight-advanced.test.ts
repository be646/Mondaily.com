import { describe, it, expect } from "vitest";
import { avgTaskLeadDays, avgDecisionCycleHours, collaborationEdges, goalAttainmentPct, isGoalMetric } from "../lib/oversight-metrics";

// These power the redesigned Team Intelligence "velocity / collaboration / goals" features. Every one
// is a pure aggregation over REAL rows — it must return null/empty when there's nothing to measure
// (never a fake 0), and never divide by zero or count self-collaboration.

describe("avgTaskLeadDays — real created→completed lead time", () => {
  const day = 86_400_000;
  const base = 1_700_000_000_000;
  it("returns null when no completed task has both timestamps", () => {
    expect(avgTaskLeadDays([])).toEqual({ avg_days: null, on_time_rate: null, sample: 0 });
    expect(avgTaskLeadDays([{ completed: false, created_at: new Date(base).toISOString() }])).toEqual({ avg_days: null, on_time_rate: null, sample: 0 });
    // completed but missing completed_at → not measurable, not a fake 0.
    expect(avgTaskLeadDays([{ completed: true, created_at: new Date(base).toISOString() }]).avg_days).toBeNull();
  });
  it("averages lead time in days and computes on-time rate against due_date", () => {
    const tasks = [
      { completed: true, created_at: new Date(base).toISOString(), completed_at: new Date(base + 2 * day).toISOString(), due_date: new Date(base + 3 * day).toISOString() },   // 2d, on time
      { completed: true, created_at: new Date(base).toISOString(), completed_at: new Date(base + 4 * day).toISOString(), due_date: new Date(base + 3 * day).toISOString() },   // 4d, late
    ];
    const r = avgTaskLeadDays(tasks);
    expect(r.avg_days).toBeCloseTo(3, 5);      // (2 + 4) / 2
    expect(r.on_time_rate).toBe(50);           // 1 of 2 within due date
    expect(r.sample).toBe(2);
  });
  it("on_time_rate is null when no completed task carried a due date", () => {
    const r = avgTaskLeadDays([{ completed: true, created_at: new Date(base).toISOString(), completed_at: new Date(base + day).toISOString() }]);
    expect(r.avg_days).toBeCloseTo(1, 5);
    expect(r.on_time_rate).toBeNull();
  });
});

describe("avgDecisionCycleHours — raised→resolved", () => {
  const hr = 3_600_000; const base = 1_700_000_000_000;
  it("null when nothing resolved", () => {
    expect(avgDecisionCycleHours([{ created_at: new Date(base).toISOString() }])).toEqual({ avg_hours: null, sample: 0 });
  });
  it("averages resolved cycle time in hours", () => {
    const r = avgDecisionCycleHours([
      { created_at: new Date(base).toISOString(), resolved_at: new Date(base + 2 * hr).toISOString() },
      { created_at: new Date(base).toISOString(), resolved_at: new Date(base + 4 * hr).toISOString() },
    ]);
    expect(r.avg_hours).toBeCloseTo(3, 5);
    expect(r.sample).toBe(2);
  });
});

describe("collaborationEdges — directed message counts", () => {
  it("counts sender→recipient, drops self and empties, busiest first", () => {
    const edges = collaborationEdges([
      { sender_id: "a", recipient_id: "b" },
      { sender_id: "a", recipient_id: "b" },
      { sender_id: "b", recipient_id: "a" },
      { sender_id: "a", recipient_id: "a" },   // self — dropped
      { sender_id: "", recipient_id: "b" },      // empty — dropped
    ]);
    expect(edges).toEqual([
      { from: "a", to: "b", count: 2 },
      { from: "b", to: "a", count: 1 },
    ]);
  });
});

describe("goals — metric registry + attainment", () => {
  it("only accepts the five real metrics", () => {
    expect(isGoalMetric("tasks_completed")).toBe(true);
    expect(isGoalMetric("deals_won")).toBe(true);
    expect(isGoalMetric("hours_worked")).toBe(false);   // not tracked — never a goal metric
    expect(isGoalMetric(42)).toBe(false);
  });
  it("attainment clamps 0–100 and never divides by a non-positive target", () => {
    expect(goalAttainmentPct(5, 10)).toBe(50);
    expect(goalAttainmentPct(15, 10)).toBe(100);   // clamped
    expect(goalAttainmentPct(5, 0)).toBe(0);       // no divide-by-zero
    expect(goalAttainmentPct(0, 10)).toBe(0);
  });
});
