import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildXlsx, crc32, colRef } from "../lib/xlsx";
import { projectSeries, resolveRanges, reportToXlsx, reportToHtml, type ReportBundle } from "../lib/report-export";

/**
 * The downloadable report — Excel + HTML with charts, KPIs and a labelled forecast.
 *
 * Built 2026-08-15 on the user's ask for daily/weekly/monthly/quarterly/yearly/custom report files.
 * Two properties are load-bearing and pinned here:
 *   1. Sovereignty: the workbook is written by OUR xlsx module, not a library — so the bytes must
 *      actually be a valid ZIP/OOXML container, verified structurally, not assumed.
 *   2. Honesty: projections are least-squares extensions of REAL buckets, labelled per point; the
 *      comparison window is the same DISTANCE into the previous period, never a full-vs-partial lie.
 */

const UTC = { timeZone: "UTC", weekStart: 0 as const };

describe("the sovereign xlsx writer produces a structurally valid workbook", () => {
  const bytes = buildXlsx([
    { name: "Summary", rows: [["Metric", "Value"], ["Closed won", 1234.5], ["Deals", 7]] },
    { name: "Bad[]:*?/\\name that is far too long for excel to accept", rows: [["a"]] },
  ], new Date("2026-08-15T12:00:00Z"));
  const text = new TextDecoder("latin1").decode(bytes);

  it("starts with the ZIP local-file signature and ends with the end-of-central-directory record", () => {
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
    // EOCD signature PK\x05\x06 must exist near the end.
    expect(text.lastIndexOf("PK\x05\x06")).toBeGreaterThan(text.length - 40);
  });

  it("contains every required OOXML part", () => {
    for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "_rels/.rels", "xl/_rels/workbook.xml.rels"]) {
      expect(text, `missing part ${part}`).toContain(part);
    }
  });

  it("writes numbers as numeric cells and strings as inline strings", () => {
    expect(text).toContain("<v>1234.5</v>");
    expect(text).toContain("<v>7</v>");
    expect(text).toContain("Closed won");
    expect(text).toContain('t="inlineStr"');
  });

  it("sanitises illegal sheet names instead of corrupting the book", () => {
    // []:*?/\ are forbidden and 31 chars is the hard cap — Excel refuses the whole file otherwise.
    const m = /<sheet name="([^"]+)" sheetId="2"/.exec(text);
    expect(m).not.toBeNull();
    expect(m![1]!.length).toBeLessThanOrEqual(31);
    expect(m![1]).not.toMatch(/[\[\]:*?/\\]/);
  });

  it("escapes XML metacharacters in cell text", () => {
    const b = buildXlsx([{ name: "S", rows: [["a<b&c\"d"]] }], new Date("2026-08-15T12:00:00Z"));
    const t = new TextDecoder("latin1").decode(b);
    expect(t).toContain("a&lt;b&amp;c&quot;d");
    expect(t).not.toContain("a<b&c");
  });

  it("crc32 matches the reference vector", () => {
    // The canonical CRC-32 check value: "123456789" → 0xCBF43926. A wrong table or missing final
    // XOR makes every archive unreadable while still looking like bytes.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("column references go A, B, …, Z, AA", () => {
    expect(colRef(0)).toBe("A");
    expect(colRef(25)).toBe("Z");
    expect(colRef(26)).toBe("AA");
  });
});

describe("the forecast is a transparent projection, never an invention", () => {
  it("extends a perfect linear trend exactly", () => {
    expect(projectSeries([10, 20, 30, 40], 2)).toEqual([50, 60]);
  });

  it("refuses to project from fewer than 3 real points", () => {
    expect(projectSeries([5, 10], 3)).toEqual([]);
    expect(projectSeries([], 3)).toEqual([]);
  });

  it("clamps a collapsing trend at zero rather than forecasting negative revenue", () => {
    const p = projectSeries([30, 20, 10], 3);
    expect(p[2]).toBe(0);
  });
});

describe("period windows follow the workspace calendar and compare like with like", () => {
  const now = new Date("2026-08-15T10:00:00Z");

  it("monthly compares Aug 1–15 with Jul 1–15, not with all of July", () => {
    const { range, prev } = resolveRanges("monthly", UTC, now);
    expect(new Date(range.start).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(new Date(prev.start).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    // Same distance into July as we are into August — 14d10h.
    expect(prev.end - prev.start).toBe(range.end - range.start);
  });

  it("daily compares today-so-far with yesterday to the same hour", () => {
    const { range, prev } = resolveRanges("daily", UTC, now);
    expect(new Date(range.start).toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(new Date(prev.start).toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(prev.end - prev.start).toBe(range.end - range.start);
  });

  it("custom treats the end date as inclusive and mirrors an equal-length prior window", () => {
    const { range, prev } = resolveRanges("custom", UTC, now, { start: "2026-06-01", end: "2026-06-30" });
    expect(new Date(range.start).toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(range.end - range.start).toBe(prev.end - prev.start);
    expect(prev.end).toBe(range.start - 1);
  });

  it("rejects a custom window with a missing or inverted range", () => {
    expect(() => resolveRanges("custom", UTC, now, { start: "2026-06-30", end: "2026-06-01" })).toThrow();
    expect(() => resolveRanges("custom", UTC, now, {})).toThrow();
  });
});

describe("both renderings carry the honesty labels", () => {
  const bundle: ReportBundle = {
    meta: {
      period: "monthly",
      range: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-15T10:00:00.000Z" },
      prevRange: { start: "2026-07-01T00:00:00.000Z", end: "2026-07-15T10:00:00.000Z" },
      base: "EUR", timeZone: "UTC", generatedAt: "2026-08-15T10:00:00.000Z", truncated: false,
      workspaceName: "Test WS", complete: false,
    },
    kpis: [
      { label: "Closed won", kind: "flow", value: 1000, previous: 500, delta: 100, count: 3, note: "1 won deal carries no close date and is excluded from period figures (250 EUR)" },
      { label: "Open pipeline (now)", kind: "balance", value: 3070, previous: null, delta: null, count: 21 },
    ],
    series: [
      { label: "2026-08-01", won: 100, collected: 50 },
      { label: "2026-08-02", won: 200, collected: 0 },
      { label: "2026-08-03", won: 300, collected: 75 },
      { label: "+1", won: 400, collected: 0, projected: true },
    ],
    forecastFrom: 3,
    weightedPipelineForecast: 812.5,
    pipelineByStage: [{ stage: "Lead", count: 13, value: 1900 }],
    topClosers: [{ owner: "Bassem", count: 2, value: 900 }],
    overdueAging: [{ bucket: "1-30d", count: 1, total: 120 }],
    openDeals: [{ name: "Acme <renewal>", stage: "Lead", value: 500, owner: "Bassem" }],
  };

  it("the workbook labels projected buckets and the undated-wins disclosure travels with the figure", () => {
    const t = new TextDecoder("latin1").decode(reportToXlsx(bundle));
    expect(t).toContain("projected (least-squares trend)");
    expect(t).toContain("no close date");
    expect(t).toContain("same distance into the previous period");
  });

  it("the HTML report dashes the projection, escapes record names, and states flow-vs-balance", () => {
    const html = reportToHtml(bundle);
    expect(html).toContain('class="line won dash"');
    expect(html).toContain("least-squares projection");
    expect(html).toContain("Acme &lt;renewal&gt;");
    expect(html).not.toContain("Acme <renewal>");
    expect(html).toContain("as of now");
    expect(html).toMatch(/Flow metrics are counted inside the window/);
  });

  it("a balance KPI never claims a period delta", () => {
    const html = reportToHtml(bundle);
    // "Open pipeline (now)" renders "as of now", not a % delta.
    const card = html.slice(html.indexOf("Open pipeline (now)"));
    expect(card.slice(0, 400)).toContain("as of now");
  });
});

describe("the surfaces are wired", () => {
  const reports = readFileSync(join(__dirname, "../routes/reports.ts"), "utf8");
  const ask = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");
  const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/index.tsx"), "utf8");

  it("export routes are registered BEFORE the /:id param route so they cannot be shadowed", () => {
    const exportIdx = reports.indexOf('router.get("/export.xlsx"');
    const paramIdx = reports.indexOf('router.get("/:id"');
    expect(exportIdx).toBeGreaterThan(-1);
    expect(paramIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeLessThan(paramIdx);
  });

  it("the xlsx route streams a real attachment with the spreadsheet MIME type", () => {
    expect(reports).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(reports).toMatch(/Content-Disposition.*attachment/);
  });

  it("Ask has the generate_report tool, routed on file-intent keywords", () => {
    expect(ask).toContain('name: "generate_report"');
    expect(ask).toMatch(/tools: \["generate_report"\], keywords: .*excel\|xlsx\|spreadsheet\|download\|export/);
    expect(ask).toMatch(/case "generate_report"/);
  });

  it("the Reports page offers all six periods as plain same-site links", () => {
    expect(page).toContain("function DownloadReport()");
    expect(page).toMatch(/"daily", "weekly", "monthly", "quarterly", "yearly", "custom"/);
    expect(page).toContain("/api/v1/reports/export.xlsx?");
    expect(page).toContain("/api/v1/reports/export.html?");
  });
});

describe("a plain link click can actually reach the export routes", () => {
  const auth = readFileSync(join(__dirname, "../middleware/auth.ts"), "utf8");

  it("requireAuth accepts ?ws= ONLY for GET report downloads (exports + archive) — found live: a top-level navigation cannot send X-Workspace-Id", () => {
    expect(auth).toContain("export\\.(xlsx|html|pdf)");
    expect(auth).toContain("archive\\/[\\w-]+\\/(xlsx|pdf)");
    expect(auth).toMatch(/c\.req\.method === "GET"/);
    // The header stays the primary transport for everything else.
    expect(auth).toContain('c.req.header("X-Workspace-Id") ?? (navExport ? c.req.query("ws") : undefined)');
  });

  it("both link producers attach the workspace to the URL", () => {
    const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/reports/index.tsx"), "utf8");
    const ask = readFileSync(join(__dirname, "../routes/ask.ts"), "utf8");
    expect(page).toMatch(/&ws=\$\{ws\}/);
    expect(ask).toMatch(/&ws=\$\{workspaceId\}/);
  });
});
