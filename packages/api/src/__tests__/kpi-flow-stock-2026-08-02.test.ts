import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { metricKind, windowLabel, windowFor } from "@mondaily/shared/period";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * "On the 1st everything resets to zero" is half right, and the wrong half is dangerous.
 */
describe("a balance never resets when the month turns", () => {
  it("classifies the money balances as STOCK", () => {
    // Windowed to the new month, these report 0 unpaid invoices on the morning of the 1st. The
    // invoices were not paid — the filter stopped counting them.
    for (const m of ["outstanding", "unpaid_invoices", "overdue_invoices", "open_pipeline", "forecast", "account_balance"]) {
      expect(metricKind(m), m).toBe("STOCK");
    }
  });

  it("classifies work-in-hand as STOCK too", () => {
    for (const m of ["overdue_tasks", "pending_decisions", "total_records", "headcount", "credits_remaining"]) {
      expect(metricKind(m), m).toBe("STOCK");
    }
  });

  it("classifies what genuinely happened in the window as FLOW", () => {
    for (const m of ["revenue_collected", "cash_collected", "expenses_approved", "credits_issued",
                     "closed_won", "pipeline_created", "deals_won_count", "tasks_completed", "net_margin"]) {
      expect(metricKind(m), m).toBe("FLOW");
    }
  });

  it("an UNKNOWN metric defaults to STOCK, the recoverable direction", () => {
    // Guessing STOCK shows a number that is too inclusive — visible, and correctable by looking.
    // Guessing FLOW hides real balances on the 1st, which looks like the money went away.
    expect(metricKind("something_nobody_registered")).toBe("STOCK");
  });

  it("STOCK is never given a window, whatever timeframe is asked for", () => {
    const cfg = { timeZone: "UTC", weekStart: 0 as const };
    for (const tf of ["TODAY", "WEEK", "MONTH", "QUARTER", "YEAR"] as const) {
      expect(windowFor("STOCK", tf, new Date(), cfg), tf).toBeNull();
    }
  });
});

describe("every KPI can say what window it covers", () => {
  it("labels a flow by its period and a stock as as-of", () => {
    expect(windowLabel("FLOW", "MONTH")).toBe("this month");
    expect(windowLabel("FLOW", "YEAR")).toBe("this year");
    expect(windowLabel("STOCK", "MONTH")).toBe("as of today");
    // The whole point: the same timeframe reads differently depending on the kind.
    expect(windowLabel("STOCK", "YEAR")).toBe(windowLabel("STOCK", "MONTH"));
  });
});

describe("there is ONE calendar deciding when the month turns", () => {
  it("the money model takes the workspace config and cannot default to the server's", () => {
    // `new Date(y, m, 1)` reads the process timezone — UTC on Vercel. Reports resolved the
    // workspace's, the browser its own, the close worker a third; a Warsaw workspace could watch
    // its Brief roll over two hours before its Reports.
    const src = read("packages/api/src/lib/money.ts");
    expect(src).toMatch(/export function monthToDate\(cfg: PeriodConfig, now: Date = new Date\(\)\): MsRange/);
    expect(src).toMatch(/periodStart\(now, "MONTHLY", cfg\)/);
    expect(src).not.toMatch(/new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\)/);
  });

  it("the config is REQUIRED, so a call site cannot silently keep the old behaviour", () => {
    // An optional config is an invitation to forget it, and forgetting it reintroduces the bug at
    // one call site while every other surface stays correct — the hardest disagreement to notice.
    expect(read("packages/api/src/lib/money.ts")).not.toMatch(/monthToDate\(cfg\?: /);
  });

  it("the same-point comparison is clamped to the shorter month", () => {
    // Comparing the 31st against a June that has no 31st would run past the month end.
    expect(read("packages/api/src/lib/money.ts")).toMatch(/Math\.min\(prev\.start\.getTime\(\) \+ offset, prev\.end\.getTime\(\)\)/);
  });

  it("Brief and Owner Console resolve the workspace calendar", () => {
    for (const f of ["packages/api/src/routes/briefing.ts", "packages/api/src/routes/owner.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/workspacePeriodConfig\(wsRow/);
      expect(src, f).toMatch(/monthToDate\(periodCfg\)/);
      expect(src, f).toMatch(/prevMonthSamePoint\(periodCfg\)/);
    }
  });
});

describe("the Brief already separated the two kinds, and still does", () => {
  it("windows the flows and leaves the balances alone", () => {
    const src = read("packages/api/src/routes/briefing.ts");
    expect(src).toMatch(/closedWonIn\(deals, mtd\)/);
    expect(src).toMatch(/pipelineCreatedIn\(deals, mtd\)/);
    // openPipeline takes no range — that is the point.
    expect(src).toMatch(/const open = openPipeline\(deals\);/);
  });
});
