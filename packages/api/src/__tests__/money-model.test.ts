import { describe, it, expect } from "vitest";
import {
  monthToDate, prevMonthSamePoint, deltaPct, dealStage, dealValue, dealOwner,
  closedWonIn, pipelineCreatedIn, openPipeline, weightedForecast, closersIn, invoiceMetrics,
  type NodeRow,
} from "../lib/money";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const deal = (o: Partial<{ id: string; data: Record<string, unknown>; created_at: string; updated_at: string }>): NodeRow => ({
  id: o.id ?? "d", data: o.data ?? {}, created_at: o.created_at ?? "2026-07-10T00:00:00Z", updated_at: o.updated_at ?? o.created_at ?? "2026-07-10T00:00:00Z",
});
const JULY: { start: number; end: number } = { start: Date.parse("2026-07-01T00:00:00Z"), end: Date.parse("2026-07-15T12:00:00Z") };

/**
 * THE money model. Every surface that says "closed won" or "cash collected" imports these; a bug
 * here is a bug on every money surface at once, so the tests are behavioral and adversarial.
 */
describe("field access matches production's split vocabulary", () => {
  it("reads stage from deal_stage, then stage, then status — measured: both exist in prod", () => {
    expect(dealStage({ deal_stage: "Closed Won", stage: "Lead" })).toBe("Closed Won");
    expect(dealStage({ stage: "Negotiation" })).toBe("Negotiation");
    expect(dealStage({ status: "Proposal" })).toBe("Proposal");
    expect(dealStage(null)).toBe("");
  });

  it("reads owner from deal_owner, then assigned_to", () => {
    expect(dealOwner({ deal_owner: "Mo", assigned_to: "Angy" })).toBe("Mo");
    expect(dealOwner({ assigned_to: "Angy" })).toBe("Angy");
  });

  it("parses currency-formatted values without inventing numbers", () => {
    expect(dealValue({ deal_value: "€12,500.50" })).toBe(12500.5);
    expect(dealValue({ deal_value: 900 })).toBe(900);
    expect(dealValue({})).toBe(0);
  });
});

describe("closed won is a FLOW dated by the WIN, never by the last edit", () => {
  // CHANGED 2026-08-02. This previously asserted an updated_at fallback for undated wins, which
  // meant any edit to a won deal re-dated the win to the day of the edit. Measured in production:
  // 9 of 10 won deals had no won_at, and unrelated schema work moved 1,422,500 of "closed won"
  // into the current month. updated_at answers "when was this row last written" — a fact about the
  // database, not the business.
  const stamped = deal({ data: { stage: "Closed Won", deal_value: 100, won_at: "2026-07-05T00:00:00Z" }, updated_at: "2026-06-01T00:00:00Z" });
  const undated = deal({ data: { stage: "Closed Won", deal_value: 50 }, updated_at: "2026-07-06T00:00:00Z" });
  const outside = deal({ data: { stage: "Closed Won", deal_value: 999, won_at: "2026-06-05T00:00:00Z" } });
  const open    = deal({ data: { stage: "Negotiation", deal_value: 999 }, updated_at: "2026-07-06T00:00:00Z" });

  it("counts only wins whose own close date falls in the window", () => {
    const r = closedWonIn([stamped, undated, outside, open], JULY);
    expect(r.count).toBe(1);
    expect(r.value).toBe(100);
  });

  it("reports the undated wins rather than dropping them silently", () => {
    // They were certainly won; we cannot say when. Saying so beats inventing a month.
    const r = closedWonIn([stamped, undated, outside, open], JULY);
    expect(r.undated).toBe(1);
    expect(r.undated_value).toBe(50);
  });

  it("an edit to an undated win does NOT pull it into the window", () => {
    // The whole point: `updated_at` sits inside JULY here, and it still must not count.
    const r = closedWonIn([undated], JULY);
    expect(r.count).toBe(0);
    expect(r.undated).toBe(1);
  });

  it("a win outside the window stays outside, and an open deal is not a win", () => {
    const r = closedWonIn([outside, open], JULY);
    expect(r).toMatchObject({ count: 0, value: 0, undated: 0 });
  });
});

describe("balance vs flow discipline", () => {
  const rows = [
    deal({ data: { stage: "Closed Won", deal_value: 100, won_at: "2026-07-02T00:00:00Z" } }),
    deal({ data: { stage: "Closed Lost", deal_value: 40 } }),
    deal({ data: { stage: "Negotiation", deal_value: 200 } }),
    deal({ data: { stage: "Lead", deal_value: 1000 }, created_at: "2026-07-03T00:00:00Z" }),
  ];
  it("open pipeline ignores closed deals entirely", () => {
    expect(openPipeline(rows)).toEqual({ count: 2, value: 1200 });
  });
  it("pipeline created counts by created_at within range regardless of current stage", () => {
    expect(pipelineCreatedIn(rows, JULY).count).toBe(4);   // all four created inside the July window — current stage is irrelevant to this flow
  });
  it("forecast weights stages and skips closed deals", () => {
    // Negotiation 200×0.75 + Lead 1000×0.1 = 250. Won/Lost contribute nothing.
    expect(weightedForecast(rows)).toBe(250);
  });
});

describe("who closed", () => {
  it("groups by owner, sorts by value, names the ownerless honestly", () => {
    const rows = [
      deal({ data: { stage: "Closed Won", deal_value: 100, deal_owner: "Mo", won_at: "2026-07-02T00:00:00Z" } }),
      deal({ data: { stage: "Closed Won", deal_value: 300, deal_owner: "Angy", won_at: "2026-07-03T00:00:00Z" } }),
      deal({ data: { stage: "Closed Won", deal_value: 50, won_at: "2026-07-04T00:00:00Z" } }),
    ];
    expect(closersIn(rows, JULY)).toEqual([
      { owner: "Angy", count: 1, value: 300 },
      { owner: "Mo", count: 1, value: 100 },
      { owner: "Unassigned", count: 1, value: 50 },
    ]);
  });
});

describe("invoice metrics", () => {
  const id = (amount: number, currency: string) => amount;   // identity converter
  const rows = [
    deal({ data: { total: 100, currency: "EUR", status: "paid", paid_at: "2026-07-05T00:00:00Z", issued_at: "2026-06-20T00:00:00Z" } }),   // issued June, paid July: collected yes, invoiced no
    deal({ data: { total: 999, currency: "EUR", status: "paid", paid_at: "2026-06-05T00:00:00Z", issued_at: "2026-05-01T00:00:00Z" } }),   // prior month entirely
    deal({ data: { total: 200, currency: "EUR", status: "sent", issued_at: "2026-07-06T00:00:00Z" } }),
    deal({ data: { total: 70, currency: "EUR", status: "overdue", due_date: "2026-07-10T00:00:00Z", issued_at: "2026-07-01T00:00:00Z" } }),
    deal({ data: { total: 30, currency: "EUR", status: "overdue", due_date: "2026-03-01T00:00:00Z", issued_at: "2026-03-01T00:00:00Z" } }),
    deal({ data: { total: 500, currency: "EUR", status: "draft" } }),
  ];
  it("separates collected (flow), invoiced (flow), outstanding (balance)", () => {
    const m = invoiceMetrics(rows, id, "EUR", JULY);
    expect(m.collected).toBe(100);          // June payment excluded from July flow
    expect(m.invoiced).toBe(270);           // sent 200 + overdue 70 issued in July; draft never counts
    expect(m.outstanding).toBe(300);        // sent + both overdue, as of now
  });
  it("ages overdue AR into buckets, undated into the oldest", () => {
    const m = invoiceMetrics(rows, id, "EUR", JULY);
    expect(m.overdue.count).toBe(2);
    expect(m.overdue.total).toBe(100);
    const old = m.overdue.aging.find(a => a.bucket === "90d+")!;
    expect(old.total).toBe(30);             // March due date is >90 days past
  });
});

describe("the comparison window is same-point, not whole-month", () => {
  it("prev window ends at the same day-offset, not month end", () => {
    // Signature changed 2026-08-02: the config comes FIRST and is required, because the month must
    // turn on the workspace's calendar rather than the server process's timezone.
    const UTC = { timeZone: "UTC", weekStart: 0 as const };
    const now = new Date("2026-07-15T10:00:00Z");
    const prev = prevMonthSamePoint(UTC, now);
    expect(new Date(prev.start).getUTCMonth()).toBe(5);        // June
    expect(new Date(prev.end).getUTCDate()).toBe(15);          // ...to June 15, not June 30
    const mtd = monthToDate(UTC, now);
    expect(new Date(mtd.start).getUTCDate()).toBe(1);
  });

  it("clamps the same-point end to a shorter previous month", () => {
    // July has a 31st; June does not. Without the clamp the comparison window would run past the
    // end of June and pull in July rows, inflating the baseline it is meant to measure against.
    const UTC = { timeZone: "UTC", weekStart: 0 as const };
    const prev = prevMonthSamePoint(UTC, new Date("2026-07-31T10:00:00Z"));
    // The range is half-open, so June's exclusive end IS July 1 00:00 — the clamp stopping exactly
    // there means the window covers all of June and not one instant of July.
    expect(prev.end).toBe(Date.parse("2026-07-01T00:00:00Z"));
    expect(prev.start).toBe(Date.parse("2026-06-01T00:00:00Z"));
  });
  it("delta from zero is null, never Infinity", () => {
    expect(deltaPct(500, 0)).toBeNull();
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(50, 100)).toBe(-50);
  });
});

describe("the brief reads through the model, with bounded reads", () => {
  const briefing = readFileSync(join(__dirname, "../routes/briefing.ts"), "utf8");
  it("no unbounded node selects remain", () => {
    // The old version selected every invoice with no limit — silent truncation at the row cap.
    expect(briefing).toMatch(/pagedNodes\(ws, \{ eq: "invoice" \}\)/);
    expect(briefing).toMatch(/pagedNodes\(ws, \{ ilike: "%deal%" \}\)/);
    expect(briefing).not.toMatch(/from\("nodes"\)\.select/);
  });
  it("every money number comes from lib/money, not re-derived locally", () => {
    for (const fn of ["closedWonIn", "pipelineCreatedIn", "openPipeline", "weightedForecast", "closersIn", "invoiceMetrics"]) {
      expect(briefing).toContain(fn);
    }
    expect(briefing).not.toMatch(/reduce\(\(s, d\) => s \+ num/);   // the old local pipeline sum
  });
});

describe("won_at is stamped at the transition and survives client round-trips", () => {
  const nodes = readFileSync(join(__dirname, "../routes/nodes.ts"), "utf8");
  it("stamps on the move INTO won, only on the transition", () => {
    expect(nodes).toMatch(/\/won\/i\.test\(after\) && !\/won\/i\.test\(before\) && !nextData\.won_at/);
  });
  it("carries an existing stamp through full-replace updates", () => {
    // updateNode replaces `data` wholesale; a client that fetched before the stamp existed and
    // edits any other field would silently erase it.
    expect(nodes).toMatch(/prevData\.won_at && !nextData\.won_at/);
    expect(nodes).toMatch(/nextData\.won_at = prevData\.won_at/);
  });
  it("the model reads pages, never one bounded select", () => {
    const money = readFileSync(join(__dirname, "../lib/money.ts"), "utf8");
    expect(money).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
    expect(money).toMatch(/if \(page\.length < PAGE\) break/);
  });
});
