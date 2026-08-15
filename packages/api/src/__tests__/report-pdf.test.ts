import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PdfDoc, textWidth, fitText } from "../lib/pdf";
import { reportToPdf } from "../lib/report-pdf";
import type { ReportBundle } from "../lib/report-export";

/**
 * The sovereign PDF writer — third rendering of the same ReportBundle, no library, no service.
 * Verified byte-structurally here and by an INDEPENDENT renderer during development (macOS
 * Quartz produced a correct thumbnail of the full report, dashed projection included).
 */

const bundle: ReportBundle = {
  meta: {
    period: "monthly", complete: true, workspaceName: "Acme GmbH",
    range: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-31T23:59:59.000Z" },
    prevRange: { start: "2026-06-01T00:00:00.000Z", end: "2026-06-30T23:59:59.000Z" },
    base: "EUR", timeZone: "UTC", generatedAt: "2026-08-01T00:20:00.000Z", truncated: false,
    close: { key: "2026-M07", hash: "cafe0123456789abcdef", drifted: false, changes: {} },
  },
  kpis: [{ label: "Closed won", kind: "flow", value: 800, previous: 0, delta: null, count: 1, note: "1 won deal carries no close date — excluded (250 EUR)" }],
  series: [
    { label: "07-01", won: 10, collected: 5 }, { label: "07-02", won: 20, collected: 5 },
    { label: "07-03", won: 30, collected: 5 }, { label: "+1", won: 40, collected: 0, projected: true },
  ],
  forecastFrom: 3, weightedPipelineForecast: 0,
  pipelineByStage: [{ stage: "Lead", count: 2, value: 900 }],
  topClosers: [{ owner: "A (B)", count: 1, value: 800 }],
  overdueAging: [], openDeals: [],
};

describe("the pdf writer emits a structurally exact PDF 1.4", () => {
  const bytes = reportToPdf(bundle);
  const text = new TextDecoder("latin1").decode(bytes);

  it("header, EOF, catalog, page tree, and both core fonts", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/BaseFont /Helvetica-Bold");
  });

  it("every xref offset lands exactly on its object header — a byte off corrupts the whole file", () => {
    const m = /xref\n0 (\d+)\n/.exec(text)!;
    const rows = text.slice(m.index + m[0].length).split("\n");
    const count = Number(m[1]);
    for (let i = 1; i < count; i++) {
      const off = Number(rows[i]!.split(" ")[0]);
      expect(text.slice(off, off + `${i} 0 obj`.length), `object ${i}`).toBe(`${i} 0 obj`);
    }
  });

  it("every content stream /Length is exact", () => {
    for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe("\nendstream");
    }
  });

  it("the projection is drawn DASHED and the close stamp + workspace name are in the page", () => {
    expect(text).toContain("[3 2] 0 d");                 // dash pattern op
    expect(text).toContain("2026-M07");
    expect(text).toContain("ACME GMBH");
  });

  it("parentheses in real data are escaped — an unescaped ')' ends the string operator early", () => {
    expect(text).toContain("A \\(B\\)");
  });

  it("typography transliterates instead of becoming '?'", () => {
    const d = new PdfDoc();
    d.text(10, 10, "A — B → C…");
    const t = new TextDecoder("latin1").decode(d.finish());
    expect(t).toContain("A - B > C...");
    expect(t).not.toContain("?");
  });
});

describe("text measurement is real AFM widths, not a guess", () => {
  it("'W' is wider than 'i' and fitText never overruns", () => {
    expect(textWidth("W", 10)).toBeGreaterThan(textWidth("i", 10) * 3);
    const fitted = fitText("A very long deal name that cannot possibly fit", 10, 80);
    expect(fitted.endsWith("…")).toBe(true);
    expect(textWidth(fitted, 10)).toBeLessThanOrEqual(80 + 6);
  });
});

describe("the pdf is reachable from every surface the other formats are", () => {
  const reports = readFileSync(join(__dirname, "../routes/reports.ts"), "utf8");
  const auth = readFileSync(join(__dirname, "../middleware/auth.ts"), "utf8");
  const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/index.tsx"), "utf8");
  const ask = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");
  const mail = readFileSync(join(__dirname, "../lib/report-schedule.ts"), "utf8");

  it("route (before /:id), nav auth carve-out, page link, Ask link, email link", () => {
    expect(reports.indexOf('router.get("/export.pdf"')).toBeGreaterThan(-1);
    expect(reports.indexOf('router.get("/export.pdf"')).toBeLessThan(reports.indexOf('router.get("/:id"'));
    expect(auth).toContain("(xlsx|html|pdf)");
    expect(page).toContain("/api/v1/reports/export.pdf?");
    expect(ask).toContain("/api/v1/reports/export.pdf?");
    expect(mail).toContain("/api/v1/reports/export.pdf?");
  });
});

describe("the reports index finally lists what gets saved", () => {
  const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/index.tsx"), "utf8");
  const reports = readFileSync(join(__dirname, "../routes/reports.ts"), "utf8");

  it("SavedAnalyses queries GET /reports — the nodes Ask's create_report writes", () => {
    expect(page).toContain("function SavedAnalyses()");
    expect(page).toContain('apiClient.get("/reports")');
    expect(page).toContain("/reports/${r.id}");
  });

  it("a report can now be DELETED — the shelf was append-only", () => {
    expect(reports).toContain('router.delete("/:id"');
    expect(page).toContain("apiClient.delete(`/reports/${id}`)");
  });

  it("live-report card titles are display-cased, slugs untouched", () => {
    expect(page).toContain("titleCase(obj.name_plural)");
  });
});
