import { PdfDoc, A4, textWidth, fitText } from "./pdf";
import type { ReportBundle, SeriesPoint } from "./report-export";

/**
 * The PDF rendering of a ReportBundle — same composition as the .xlsx and .html, third format.
 * Layout is a top-down cursor over A4 with automatic page breaks; PDF's bottom-left origin is
 * converted at the last moment (Y = page height − cursor). Charts are drawn with the writer's
 * rect/polyline ops — the projection stays DASHED here too, the same honesty rule as the HTML.
 */

const M = 48;                       // page margin
const W = A4.w - M * 2;             // content width
const INK: [number, number, number] = [0.07, 0.09, 0.15];
const MUTED: [number, number, number] = [0.42, 0.45, 0.5];
const FAINT: [number, number, number] = [0.61, 0.64, 0.69];
const LINE: [number, number, number] = [0.9, 0.91, 0.92];
const GREEN: [number, number, number] = [0.05, 0.62, 0.43];
const BLUE: [number, number, number] = [0.23, 0.51, 0.96];
const AMBER: [number, number, number] = [0.71, 0.4, 0.11];

const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

class Layout {
  doc = new PdfDoc();
  private cursor = M;
  get y(): number { return A4.h - this.cursor; }
  /** Advance the cursor; new page when the next block would fall off the bottom. */
  need(h: number): void {
    if (this.cursor + h > A4.h - M) { this.doc.newPage(); this.cursor = M; }
  }
  advance(h: number): void { this.cursor += h; }
}

export function reportToPdf(b: ReportBundle): Uint8Array {
  const L = new Layout();
  const d = L.doc;
  const dt = (iso: string) => iso.slice(0, 10);
  const periodTitle = b.meta.period[0]!.toUpperCase() + b.meta.period.slice(1);

  // ── Header ──
  d.text(M, L.y, b.meta.workspaceName.toUpperCase(), { size: 8, color: MUTED });
  L.advance(16);
  d.text(M, L.y, `${periodTitle} report${b.meta.complete ? " — completed period" : ""}`, { size: 19, bold: true });
  L.advance(16);
  d.text(M, L.y, `${dt(b.meta.range.start)} → ${dt(b.meta.range.end)} · compared with ${dt(b.meta.prevRange.start)} → ${dt(b.meta.prevRange.end)} · ${b.meta.timeZone} · base ${b.meta.base}`, { size: 8.5, color: MUTED });
  L.advance(20);

  // ── KPI table ──
  const col2 = M + W * 0.5, col3 = M + W * 0.66;
  for (const k of b.kpis) {
    L.need(k.note ? 26 : 15);
    d.text(M, L.y, k.label, { size: 9.5, maxWidth: W * 0.46 });
    d.text(col2 + 60, L.y, `${fmt(k.value)} ${b.meta.base}`, { size: 9.5, bold: true, align: "right" });
    const sub = k.kind === "balance" ? "as of now"
      : k.delta == null ? (k.previous != null ? `prev ${fmt(k.previous)}` : "no prior base")
      : `${k.delta >= 0 ? "+" : ""}${k.delta}% vs same window last period (${fmt(k.previous ?? 0)})`;
    d.text(col3 + 30, L.y, sub, { size: 8, color: MUTED, maxWidth: W - (col3 + 30 - M) });
    L.advance(12);
    if (k.note) {
      d.text(M + 8, L.y, fitText(k.note, 7.5, W - 8), { size: 7.5, color: AMBER });
      L.advance(11);
    }
    d.line(M, L.y + 8, M + W, L.y + 8);
    L.advance(4);
  }
  L.advance(14);

  // ── Trend chart: closed won + collected, projection dashed ──
  if (b.series.length >= 2) {
    L.need(170);
    d.text(M, L.y, "Closed won & cash collected", { size: 11, bold: true });
    L.advance(12);
    d.text(M, L.y, "green = closed won · blue = cash collected" + (b.forecastFrom ? " · dashed = least-squares projection of the real trend" : ""), { size: 7.5, color: MUTED });
    L.advance(12);
    const CH = 110;
    const top = L.y, bottom = top - CH;
    const max = Math.max(1, ...b.series.map(s => Math.max(s.won, s.collected)));
    const x = (i: number) => M + 36 + (i * (W - 44)) / Math.max(1, b.series.length - 1);
    const yv = (v: number) => bottom + (v / max) * CH;
    d.line(M + 36, bottom, M + W, bottom, { color: LINE });
    for (const f of [0, 0.5, 1]) d.text(M + 32, yv(max * f) - 3, fmt(Math.round(max * f)), { size: 7, color: FAINT, align: "right" });
    const pts = (pick: (s: SeriesPoint) => number, from: number, to: number): [number, number][] =>
      b.series.slice(from, to).map((s, i) => [x(from + i), yv(pick(s))]);
    const solidEnd = b.forecastFrom ?? b.series.length;
    d.polyline(pts(s => s.collected, 0, solidEnd), { color: BLUE, width: 1.2 });
    d.polyline(pts(s => s.won, 0, solidEnd), { color: GREEN, width: 1.5 });
    if (b.forecastFrom) d.polyline(pts(s => s.won, b.forecastFrom - 1, b.series.length), { color: GREEN, width: 1.5, dash: [3, 2] });
    const step = Math.ceil(b.series.length / 7);
    b.series.forEach((s, i) => {
      if (i % step === 0 || s.projected) d.text(x(i), bottom - 10, s.label, { size: 6.5, color: FAINT, align: "center" });
    });
    L.advance(CH + 26);
  }

  // ── Pipeline by stage: horizontal bars ──
  if (b.pipelineByStage.length) {
    L.need(30 + b.pipelineByStage.length * 16);
    d.text(M, L.y, "Open pipeline by stage (as of now)", { size: 11, bold: true });
    L.advance(16);
    const maxV = Math.max(1, ...b.pipelineByStage.map(s => s.value));
    const labelW = 110, valueW = 70;
    for (const s of b.pipelineByStage) {
      const bw = Math.max(2, ((W - labelW - valueW) * s.value) / maxV);
      d.text(M + labelW - 6, L.y, fitText(s.stage, 8.5, labelW - 8), { size: 8.5, align: "right" });
      d.rect(M + labelW, L.y - 2, bw, 9, GREEN);
      d.text(M + labelW + bw + 6, L.y, `${fmt(s.value)} · ${s.count}`, { size: 8, color: MUTED });
      L.advance(16);
    }
    L.advance(10);
  }

  // ── Tables: top closers, overdue aging, open deals ──
  const table = (title: string, headers: string[], rows: (string | number)[][], widths: number[]) => {
    if (!rows.length) return;
    L.need(34 + Math.min(rows.length, 5) * 13);
    L.doc.text(M, L.y, title, { size: 11, bold: true });
    L.advance(14);
    let cx = M;
    headers.forEach((h, i) => { L.doc.text(cx, L.y, h.toUpperCase(), { size: 7, color: MUTED }); cx += widths[i]!; });
    L.advance(11);
    for (const r of rows) {
      L.need(13);
      cx = M;
      r.forEach((cell, i) => {
        const num = typeof cell === "number";
        L.doc.text(num ? cx + widths[i]! - 14 : cx, L.y, num ? fmt(cell) : fitText(String(cell), 8.5, widths[i]! - 10), { size: 8.5, align: num ? "right" : "left" });
        cx += widths[i]!;
      });
      L.advance(11);
      L.doc.line(M, L.y + 7, M + W, L.y + 7);
      L.advance(2);
    }
    L.advance(14);
  };
  table("Top closers", ["Owner", "Deals won", `Value (${b.meta.base})`], b.topClosers.map(c => [c.owner, c.count, c.value]), [W * 0.5, W * 0.25, W * 0.25]);
  table("Overdue invoices — aging", ["Bucket", "Invoices", `Total (${b.meta.base})`], b.overdueAging.filter(a => a.count > 0).map(a => [a.bucket, a.count, a.total]), [W * 0.5, W * 0.25, W * 0.25]);
  table("Open deals", ["Deal", "Stage", `Value (${b.meta.base})`, "Owner"], b.openDeals.slice(0, 30).map(x => [x.name, x.stage, x.value, x.owner]), [W * 0.4, W * 0.2, W * 0.2, W * 0.2]);

  // ── Footer: close stamp + honesty line ──
  L.need(40);
  if (b.meta.close) {
    const c = b.meta.close;
    const driftTxt = c.drifted
      ? `the live ledger has moved since the close — ${Object.entries(c.changes).map(([k, v]) => `${k} ${fmt(v.snapshot)} → ${fmt(v.live)}`).join("; ")} (disclosed, not reconciled)`
      : "recomputation agrees with the filed figures";
    d.text(M, L.y, fitText(`Filed close snapshot ${c.key} (hash ${c.hash.slice(0, 16)}…): ${driftTxt}`, 7.5, W), { size: 7.5, color: MUTED });
    L.advance(11);
  }
  d.text(M, L.y, `Generated by Mondaily for ${b.meta.workspaceName} on ${b.meta.generatedAt.slice(0, 16).replace("T", " ")} UTC.`, { size: 7.5, color: FAINT });
  L.advance(10);
  d.text(M, L.y, "Flow metrics are counted inside the window; balance metrics are as of generation time. Projections are labelled, never blended into actuals.", { size: 7.5, color: FAINT, maxWidth: W });

  return d.finish();
}

export { textWidth };
