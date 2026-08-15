import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveRanges, expensesIn, reportToHtml, reportToXlsx, type ReportBundle } from "../lib/report-export";
import { currentPeriodKey, readSchedule, reportEmailHtml, REPORT_CADENCES } from "../lib/report-schedule";
import type { NodeRow } from "../lib/money";

/**
 * Scheduled delivery + expenses/net + close alignment — the three recommendation builds of
 * 2026-08-15, each with the property that makes it trustworthy pinned:
 *
 *   - A scheduled send covers the last COMPLETED period, full-against-full — never the first
 *     hours of a new period, never partial-vs-whole.
 *   - Idempotence is a recorded period key, not a "sent recently" heuristic.
 *   - Expenses use the SAME population rule as the period-close snapshot (approved/verified only).
 *   - A completed period that has a filed close snapshot carries its hash, and drift is disclosed,
 *     never silently reconciled.
 */

const UTC = { timeZone: "UTC", weekStart: 0 as const };
const now = new Date("2026-08-15T10:00:00Z");

describe("a completed-period window is whole-against-whole", () => {
  it("monthly complete = ALL of July vs ALL of June", () => {
    const { range, prev } = resolveRanges("monthly", UTC, now, undefined, true);
    expect(new Date(range.start).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(new Date(range.end + 1).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(new Date(prev.start).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(new Date(prev.end + 1).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("daily complete = all of yesterday vs all of the day before", () => {
    const { range, prev } = resolveRanges("daily", UTC, now, undefined, true);
    expect(new Date(range.start).toISOString().slice(0, 10)).toBe("2026-08-14");
    expect(new Date(prev.start).toISOString().slice(0, 10)).toBe("2026-08-13");
    expect(range.end - range.start).toBe(prev.end - prev.start);
  });

  it("complete=false keeps the period-to-date behaviour unchanged", () => {
    const { range } = resolveRanges("monthly", UTC, now, undefined, false);
    expect(new Date(range.start).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.end).toBe(now.getTime());
  });
});

describe("expenses count exactly what the period close counts", () => {
  const row = (status: string, cents: number, date: string): NodeRow => ({
    id: date + status, created_at: date, updated_at: date,
    data: { status, amount_cents: cents, date },
  });
  const toBase = (n: number) => n;
  const range = { start: Date.parse("2026-07-01"), end: Date.parse("2026-07-31T23:59:59Z") };

  it("approved and verified are in; draft and rejected are OUT — a submitted expense is not yet money spent", () => {
    const rows = [
      row("approved", 10_000, "2026-07-10"),
      row("verified", 5_000, "2026-07-12"),
      row("draft", 99_900, "2026-07-13"),
      row("rejected", 99_900, "2026-07-14"),
      row("submitted", 99_900, "2026-07-15"),
    ];
    const r = expensesIn(rows, toBase, "EUR", range);
    expect(r).toEqual({ total: 150, count: 2 });
  });

  it("dated by the expense's own date, not the row's created_at", () => {
    const r: NodeRow = { id: "x", created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-20T00:00:00Z",
      data: { status: "approved", amount_cents: 7_700, date: "2026-06-05" } };
    expect(expensesIn([r], toBase, "EUR", range).count).toBe(0); // June expense, July window
  });
});

describe("the schedule's idempotence anchor is a period key", () => {
  it("daily key is the workspace-local date; monthly key matches the period system", () => {
    expect(currentPeriodKey("daily", UTC, now)).toBe("2026-08-15");
    expect(currentPeriodKey("monthly", UTC, now)).toBe("2026-M08");
  });

  it("the key changes exactly when the period rolls over — that change IS the send trigger", () => {
    const lastOfMonth = new Date("2026-08-31T23:59:00Z");
    const firstOfNext = new Date("2026-09-01T00:01:00Z");
    expect(currentPeriodKey("monthly", UTC, lastOfMonth)).toBe("2026-M08");
    expect(currentPeriodKey("monthly", UTC, firstOfNext)).toBe("2026-M09");
  });

  it("readSchedule tolerates missing/garbage settings and only honours literal true", () => {
    expect(readSchedule(null).enabled).toEqual({});
    expect(readSchedule({ report_schedule: { enabled: { weekly: "yes", monthly: true } } }).enabled).toEqual({ monthly: true });
  });
});

const bundle: ReportBundle = {
  meta: {
    period: "monthly", complete: true,
    range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.000Z" },
    prevRange: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-30T23:59:59.000Z" },
    base: "USD", timeZone: "UTC", generatedAt: "2026-08-01T00:20:00.000Z", truncated: false,
    close: { key: "2026-M07", hash: "abcdef0123456789deadbeef", drifted: true, changes: { revenue_collected: { snapshot: 1000, live: 1200 } } },
  },
  kpis: [
    { label: "Expenses", kind: "flow", value: 150, previous: 90, delta: 67, count: 2, note: "approved/verified expenses only — the same population the period close counts" },
    { label: "Net cash (collected − expenses)", kind: "flow", value: 850, previous: 910, delta: -7 },
    { label: "Open pipeline (now)", kind: "balance", value: 3070, previous: null, delta: null },
  ],
  series: [], forecastFrom: null, weightedPipelineForecast: 0,
  pipelineByStage: [], topClosers: [], overdueAging: [], openDeals: [],
};

describe("the close snapshot travels with a completed report, drift disclosed", () => {
  it("HTML: hash + each drifted metric, and the completed-period title", () => {
    const html = reportToHtml(bundle);
    expect(html).toContain("completed period");
    expect(html).toContain("2026-M07");
    expect(html).toContain("abcdef0123456789"); // first 16 of the hash
    expect(html).toContain("revenue_collected 1,000 → 1,200");
    expect(html).toContain("disclosed, not reconciled");
  });

  it("XLSX: the Summary sheet carries the snapshot row and the drift line", () => {
    const t = new TextDecoder("latin1").decode(reportToXlsx(bundle));
    expect(t).toContain("Close snapshot");
    expect(t).toContain("2026-M07");
    expect(t).toContain("DRIFT since close");
  });
});

describe("the scheduled email tells the truth in every client", () => {
  const { subject, body } = reportEmailHtml(bundle, "ws-123");

  it("subject names the covered window", () => {
    expect(subject).toBe("Monthly report — 2026-07-01 → 2026-07-31");
  });

  it("links carry complete=1 and the workspace (a mail client link is a top-level navigation)", () => {
    expect(body).toContain("period=monthly&complete=1&ws=ws-123");
    expect(body).toContain("/api/v1/reports/export.xlsx?");
    expect(body).toContain("/api/v1/reports/export.html?");
  });

  it("styling is inline and balances say 'as of send time' — email clients strip stylesheets", () => {
    expect(body).not.toContain("<style");
    expect(body).toContain("as of send time");
    expect(body).toContain("the same population the period close counts");
  });
});

describe("the delivery machinery is wired the period-close way", () => {
  const sched = readFileSync(join(__dirname, "../lib/report-schedule.ts"), "utf8");
  const appTs = readFileSync(join(__dirname, "../app.ts"), "utf8");
  const vercel = readFileSync(join(__dirname, "../../vercel.json"), "utf8");
  const reports = readFileSync(join(__dirname, "../routes/reports.ts"), "utf8");

  it("an HOURLY cron exists, fail-closed on CRON_SECRET like every other cron", () => {
    expect(appTs).toContain('app.get("/api/cron/report-delivery"');
    const block = appTs.slice(appTs.indexOf('app.get("/api/cron/report-delivery"'));
    expect(block.slice(0, 600)).toContain("Cron disabled — CRON_SECRET is not configured");
    expect(vercel).toMatch(/"\/api\/cron\/report-delivery",\s*"schedule":\s*"20 \* \* \* \*"/);
  });

  it("last_sent is recorded ONLY after a successful send — a failed send stays due", () => {
    const sendIdx = sched.indexOf("await sendWorkspaceEmail(");
    const recordIdx = sched.indexOf('Record the send ONLY after it succeeded');
    expect(sendIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeGreaterThan(sendIdx);
    // The transport declining must bail BEFORE the settings write.
    expect(sched).toMatch(/if \(!ok\) \{ out\.push\(\{[^}]*status: "failed"[^}]*\}\); continue; \}/);
  });

  it("enabling a cadence anchors last_sent to the CURRENT period, so no instant backfill email", () => {
    expect(reports).toContain("if (cleaned[cad] && !prev.enabled[cad]) last_sent[cad] = currentPeriodKey(cad, cfg, new Date());");
  });

  it("the send-test route reuses the exact cron template — one composition path, not a lookalike", () => {
    expect(reports).toContain('router.post("/schedule/send-test"');
    const block = reports.slice(reports.indexOf('router.post("/schedule/send-test"'));
    expect(block.slice(0, 900)).toContain("reportEmailHtml(bundle, ws)");
    expect(block.slice(0, 900)).toContain("{ complete: true }");
  });

  it("all five cadences exist and recipients are owners/admins", () => {
    expect([...REPORT_CADENCES]).toEqual(["daily", "weekly", "monthly", "quarterly", "yearly"]);
    expect(sched).toContain('.in("role", ["owner", "admin"])');
  });
});
