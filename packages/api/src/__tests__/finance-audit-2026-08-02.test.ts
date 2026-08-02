import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBilled, isCollected, isOutstanding, moneyEventDate } from "@mondaily/shared/finance";

/**
 * Finance page audit. The headline finding was a truth bug on the reports chart, measured on live
 * data: all £102,501 of collected cash showed in June, when £95,801 of it landed in July.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const reports = () => read("apps/app/src/routes/dashboard/finance/reports.tsx");

describe("one definition of what an invoice status means", () => {
  it("billing excludes drafts and cancellations", () => {
    expect(isBilled("sent")).toBe(true);
    expect(isBilled("paid")).toBe(true);
    expect(isBilled("draft")).toBe(false);
    expect(isBilled("cancelled")).toBe(false);
  });

  it("outstanding is money owed now — not settled, not unsent", () => {
    for (const s of ["sent", "viewed", "overdue"]) expect(isOutstanding(s), s).toBe(true);
    for (const s of ["paid", "draft", "cancelled"]) expect(isOutstanding(s), s).toBe(false);
  });

  it("collected is cash in the door", () => {
    expect(isCollected("paid")).toBe(true);
    expect(isCollected("overdue")).toBe(false);
  });

  it("handles junk without throwing — statuses arrive from stored data", () => {
    for (const v of [null, undefined, "", "NONSENSE", 42]) {
      expect(isBilled(v as unknown)).toBe(false);
      expect(isOutstanding(v as unknown)).toBe(false);
    }
  });
});

describe("money is dated when it moved, not when the record was made", () => {
  it("a paid invoice is dated by payment", () => {
    expect(moneyEventDate({ status: "paid", paid_at: "2026-07-15", created_at: "2026-06-01" }))
      .toBe("2026-07-15");
  });

  it("an unpaid invoice falls back to creation", () => {
    expect(moneyEventDate({ status: "sent", paid_at: null, created_at: "2026-06-01" }))
      .toBe("2026-06-01");
  });

  it("a paid invoice with no payment timestamp still has a date", () => {
    expect(moneyEventDate({ status: "paid", created_at: "2026-06-01" })).toBe("2026-06-01");
  });

  it("reproduces the measured bug: June invoices paid in July are JULY cash", () => {
    // Live figures 2026-08-02: 7 paid invoices, 3 of them paid outside their creation month.
    const live = [
      { status: "paid", created_at: "2026-06-10", paid_at: "2026-06-20", total: 6700 },
      { status: "paid", created_at: "2026-06-11", paid_at: "2026-07-02", total: 95800.9977 },
    ];
    const byCreated = live.filter(i => i.created_at.slice(0, 7) === "2026-06").reduce((s, i) => s + i.total, 0);
    const byEvent = live.filter(i => moneyEventDate(i).slice(0, 7) === "2026-06").reduce((s, i) => s + i.total, 0);
    expect(Math.round(byCreated)).toBe(102501);   // what the chart used to show for June
    expect(Math.round(byEvent)).toBe(6700);       // what actually landed in June
  });
});

describe("the reports surface uses the shared definitions", () => {
  it("the monthly chart no longer counts every invoice as billed", () => {
    const src = reports();
    expect(src).toMatch(/isBilled\(i\.status\) && i\.created_at\.slice\(0, 7\) === m\.key/);
    expect(src).not.toMatch(/const monthInvoices = invoices\.filter\(i => i\.created_at\.slice\(0, 7\) === m\.key\)/);
  });

  it("collected is bucketed by when the money moved", () => {
    expect(reports()).toMatch(/isCollected\(i\.status\) && moneyEventDate\(i\)\.slice\(0, 7\) === m\.key/);
  });

  it("top clients bill, collect and owe by the same rules as the server rollup", () => {
    const src = reports();
    expect(src).toMatch(/if \(isBilled\(inv\.status\)\) entry\.billed \+= amount;/);
    expect(src).toMatch(/if \(isOutstanding\(inv\.status\)\) entry\.outstanding \+= amount;/);
    // outstanding is measured, not derived from billed − paid over an unfiltered set
    expect(src).not.toMatch(/outstanding: d\.billed - d\.paid/);
  });

  it("no surface still hardcodes the status list", () => {
    for (const p of [
      "apps/app/src/routes/dashboard/finance/reports.tsx",
      "apps/app/src/routes/dashboard/finance/invoices.tsx",
      "apps/app/src/routes/dashboard/insights.tsx",
      "apps/app/src/routes/dashboard/finance/[invoiceId].tsx",
      "packages/api/src/routes/invoices.ts",
      "packages/api/src/lib/money.ts",
    ]) {
      expect(read(p), p).not.toMatch(/\["sent", "viewed", "overdue"\]/);
    }
  });
});

describe("finance writes are scoped at the statement that mutates", () => {
  it("every update carries the workspace filter, not just the read before it", () => {
    for (const p of ["invoices", "quotes", "expenses", "credit-notes"]) {
      const src = read(`packages/api/src/routes/${p}.ts`);
      const updates = src.split('.update({ data: updatedData').slice(1);
      expect(updates.length, `${p} has no updatedData writes`).toBeGreaterThan(0);
      for (const u of updates) {
        expect(u.slice(0, 500), `${p} update must be workspace-scoped`).toMatch(/\.eq\("workspace_id"/);
      }
    }
  });
});
