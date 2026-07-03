import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workQuality, type OperatorMetrics } from "../lib/oversight-metrics";

/**
 * Team-intelligence calculation logic + workspace-isolation guard for the new oversight queries.
 * workQuality is pure — every signal must be source-backed and say "insufficient" (never fabricate)
 * when the inputs are absent.
 */

const base: OperatorMetrics = {
  open_tasks: 0, overdue_tasks: 0, completed_tasks: 0, task_count: 0, decisions_resolved: 0, last_active_at: null,
};
const sig = (op: Partial<OperatorMetrics>, key: string) => workQuality({ ...base, ...op }).find(s => s.key === key)!;

describe("workQuality — follow-up discipline", () => {
  it("insufficient when no open tasks", () => {
    expect(sig({}, "follow_up").level).toBe("insufficient");
  });
  it("good when nothing overdue", () => {
    const s = sig({ open_tasks: 5, overdue_tasks: 0 }, "follow_up");
    expect(s.level).toBe("good");
    expect(s.basis).toMatch(/0 of 5/);
  });
  it("risk when most open tasks are overdue", () => {
    expect(sig({ open_tasks: 1, overdue_tasks: 4 }, "follow_up").level).toBe("risk"); // 4/5 = 80%
  });
  it("watch at a moderate slip", () => {
    expect(sig({ open_tasks: 3, overdue_tasks: 1 }, "follow_up").level).toBe("watch"); // 1/4 = 25%
  });
});

describe("workQuality — overdue risk (absolute count)", () => {
  it("good at zero", () => expect(sig({}, "overdue_risk").level).toBe("good"));
  it("watch at 1-2", () => expect(sig({ open_tasks: 2, overdue_tasks: 2 }, "overdue_risk").level).toBe("watch"));
  it("risk at 3+", () => expect(sig({ open_tasks: 3, overdue_tasks: 3 }, "overdue_risk").level).toBe("risk"));
});

describe("workQuality — activity consistency (recency, injectable via last_active_at)", () => {
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  it("insufficient with no activity", () => {
    expect(sig({ task_count: 0, last_active_at: null }, "consistency").level).toBe("insufficient");
  });
  it("good when active in the last 3 days", () => {
    expect(sig({ task_count: 10, last_active_at: iso(1) }, "consistency").level).toBe("good");
  });
  it("risk when idle 8+ days", () => {
    expect(sig({ task_count: 4, last_active_at: iso(10) }, "consistency").level).toBe("risk");
  });
});

describe("workQuality — decision participation", () => {
  it("insufficient at zero (not fabricated)", () => {
    expect(sig({}, "decisions").level).toBe("insufficient");
  });
  it("good at 3+", () => {
    const s = sig({ decisions_resolved: 4 }, "decisions");
    expect(s.level).toBe("good");
    expect(s.basis).toMatch(/4 decision/);
  });
  it("watch at 1-2", () => expect(sig({ decisions_resolved: 1 }, "decisions").level).toBe("watch"));
});

describe("workQuality — handoff quality is honest about missing data", () => {
  it("insufficient because reassignments are not tracked", () => {
    const s = sig({}, "handoff");
    expect(s.level).toBe("insufficient");
    expect(s.basis).toMatch(/not tracked/i);
  });
});

describe("workQuality — shape", () => {
  it("always returns the five signals in stable order", () => {
    const keys = workQuality(base).map(s => s.key);
    expect(keys).toEqual(["follow_up", "overdue_risk", "consistency", "decisions", "handoff"]);
  });
});

describe("workspace isolation — new oversight-matrix queries scope by workspace_id", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/activities.ts", import.meta.url)), "utf8");
  it("internal_messages tally is workspace-scoped", () => {
    expect(src).toMatch(/from\("internal_messages"\)\.select\("sender_id"\)\.eq\("workspace_id", ws\)/);
  });
  it("decision participation tally is workspace-scoped", () => {
    expect(src).toMatch(/from\("decision_queue"\)\.select\("resolved_by"\)\.eq\("workspace_id", ws\)/);
  });
});
