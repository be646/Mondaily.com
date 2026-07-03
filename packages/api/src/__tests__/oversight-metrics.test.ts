import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { workQuality, aggregateDeals, dailyTrend, evaluationLabel, dealStageClass, isDealType, type OperatorMetrics, type DealNode } from "../lib/oversight-metrics";

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

describe("aggregateDeals — ownership matching + won/lost classification (real fields only)", () => {
  const members = [
    { user_id: "u_alice", email: "alice@acme.com", name: "Alice" },
    { user_id: "u_bob", email: "bob@acme.com", name: "Bob" },
  ];
  const deals: DealNode[] = [
    { id: "d1", object_type: "deal", data: { owner_id: "u_alice", stage: "closed_won" } },
    { id: "d2", object_type: "opportunity", data: { assignee: "alice@acme.com", stage: "negotiation" } }, // open
    { id: "d3", object_type: "deal", data: { rep: "Bob", status: "closed_lost" } },
    { id: "d4", object_type: "deal", data: {}, created_by: "u_bob" }, // owned via created_by, open
    { id: "d5", object_type: "company", data: { owner_id: "u_alice" } }, // NOT a deal → ignored
  ];
  const agg = aggregateDeals(deals, members);

  it("matches owner by user_id, email, name, and created_by", () => {
    expect(agg.get("u_alice")!.owned).toBe(2); // d1 (owner_id) + d2 (email)
    expect(agg.get("u_bob")!.owned).toBe(2);   // d3 (name "Bob") + d4 (created_by)
  });
  it("classifies won / lost / open from stage/status", () => {
    expect(agg.get("u_alice")!.won).toBe(1);
    expect(agg.get("u_alice")!.open).toBe(1);
    expect(agg.get("u_bob")!.lost).toBe(1);
    expect(agg.get("u_bob")!.open).toBe(1);
  });
  it("ignores non-deal object types", () => {
    expect(agg.get("u_alice")!.owned).not.toBe(3); // d5 excluded
    expect(isDealType("company")).toBe(false);
    expect(isDealType("sales_deal")).toBe(true);
  });
  it("dealStageClass reads deal_stage/stage/status", () => {
    expect(dealStageClass({ deal_stage: "Closed Won" })).toBe("won");
    expect(dealStageClass({ status: "closed-lost" })).toBe("lost");
    expect(dealStageClass({ stage: "prospecting" })).toBe("open");
    expect(dealStageClass({})).toBe("open");
  });
  it("a member owning no deals is absent (never fabricated)", () => {
    expect(aggregateDeals([], members).size).toBe(0);
  });
});

describe("dailyTrend — deterministic bucketing (injectable now)", () => {
  const NOW = Date.UTC(2026, 6, 10, 12, 0, 0); // 2026-07-10
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 8)).toISOString();
  it("zero-fills the last N days oldest→newest", () => {
    const t = dailyTrend([], () => null, 7, NOW);
    expect(t.length).toBe(7);
    expect(t[6].date).toBe("2026-07-10");
    expect(t[0].date).toBe("2026-07-04");
    expect(t.every(p => p.value === 0)).toBe(true);
  });
  it("counts items on their day and ignores out-of-window items", () => {
    const items = [iso(2026, 6, 10), iso(2026, 6, 10), iso(2026, 6, 9), iso(2026, 5, 1) /* out */];
    const t = dailyTrend(items, (x) => x, 7, NOW);
    expect(t.find(p => p.date === "2026-07-10")!.value).toBe(2);
    expect(t.find(p => p.date === "2026-07-09")!.value).toBe(1);
    expect(t.reduce((s, p) => s + p.value, 0)).toBe(3); // June 1 excluded
  });
  it("supports a value accessor (e.g. token sums)", () => {
    const items = [{ at: iso(2026, 6, 10), tok: 500 }, { at: iso(2026, 6, 10), tok: 250 }];
    const t = dailyTrend(items, (x) => x.at, 7, NOW, (x) => x.tok);
    expect(t.find(p => p.date === "2026-07-10")!.value).toBe(750);
  });
});

describe("evaluationLabel — source-backed labels, not scores", () => {
  it("Inactive when nothing tracked", () => expect(evaluationLabel({ open_tasks: 0, overdue_tasks: 0, task_count: 0, decisions_resolved: 0 }).label).toBe("Inactive"));
  it("At risk of overdue work at 3+ overdue", () => expect(evaluationLabel({ open_tasks: 5, overdue_tasks: 3, task_count: 10, decisions_resolved: 0 }).label).toBe("At risk of overdue work"));
  it("Needs follow-up at 1-2 overdue", () => expect(evaluationLabel({ open_tasks: 4, overdue_tasks: 1, task_count: 5, decisions_resolved: 0 }).label).toBe("Needs follow-up"));
  it("Decision contributor when resolving decisions and no overdue", () => expect(evaluationLabel({ open_tasks: 2, overdue_tasks: 0, task_count: 8, decisions_resolved: 4 }).label).toBe("Decision contributor"));
  it("Balanced workload otherwise", () => expect(evaluationLabel({ open_tasks: 3, overdue_tasks: 0, task_count: 6, decisions_resolved: 1 }).label).toBe("Balanced workload"));
});

describe("workspace isolation + grounded Ask (source-read guards)", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/activities.ts", import.meta.url)), "utf8");
  it("internal_messages tally is workspace-scoped", () => {
    expect(src).toMatch(/from\("internal_messages"\)\.select\("sender_id, created_at"\)\.eq\("workspace_id", ws\)/);
  });
  it("decision participation tally is workspace-scoped", () => {
    expect(src).toMatch(/from\("decision_queue"\)\.select\("resolved_by, resolved_at"\)\.eq\("workspace_id", ws\)/);
  });
  it("deal-node query is workspace-scoped", () => {
    expect(src).toMatch(/from\("nodes"\)\.select\("id, object_type, data, created_by"\)\.eq\("workspace_id", ws\)/);
  });
  it("oversight-ask is admin-gated and returns insufficient without data (no model call)", () => {
    expect(src).toMatch(/router\.post\("\/oversight-ask", requireAuth, requireAdminRole/);
    expect(src).toMatch(/if \(!anyData \|\| lines\.length === 0\)[\s\S]*sufficient: false/);
  });
  it("oversight-ask queries are workspace-scoped", () => {
    // Each of the five ask-endpoint reads must carry the workspace filter.
    const askBlock = src.slice(src.indexOf('router.post("/oversight-ask"'));
    const reads = (askBlock.slice(0, askBlock.indexOf("// One grounded line")).match(/\.from\("/g) ?? []).length;
    const guards = (askBlock.slice(0, askBlock.indexOf("// One grounded line")).match(/\.eq\("workspace_id", ws\)/g) ?? []).length;
    expect(reads).toBeGreaterThan(0);
    expect(guards).toBeGreaterThanOrEqual(reads);
  });
});
