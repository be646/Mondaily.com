import { supabase } from "@mondaily/db/client";
import { periodStart, previousPeriod, periodBounds, periodKey, instantOf, wallClock, type PeriodConfig, type PeriodType } from "@mondaily/shared/period";
import { workspacePeriodConfig, driftFor } from "./period-close";
import { readMoney } from "@mondaily/shared/money";
import { makeBaseConverter } from "./currency-store";
import {
  pagedNodes, closedWonIn, pipelineCreatedIn, openPipeline, weightedForecast, closersIn,
  invoiceMetrics, deltaPct, dealStage, dealValue, wonDate, isOpen, type NodeRow, type MsRange,
} from "./money";
import { buildXlsx, type XlsxSheet } from "./xlsx";

/**
 * The downloadable workspace report — one composition, two renderings (.xlsx and .html).
 *
 * Every figure comes from lib/money — THE definitions the Brief, Owner Console and Reports already
 * share — so a downloaded report can never disagree with the screens it summarises. Nothing here
 * computes a metric of its own.
 *
 * Period semantics follow the product's flow-vs-stock rule:
 *   - FLOW rows (closed won, pipeline created, collected, invoiced) are counted INSIDE the window.
 *   - BALANCE rows (open pipeline, outstanding, overdue, weighted forecast) are as-of-now and
 *     labelled as such — a "monthly" report does not pretend the balance belongs to the month.
 *   - The comparison window is the SAME DISTANCE into the previous period (Aug 1–15 vs Jul 1–15),
 *     because comparing 15 days against 31 makes every period look like a collapse until the 20th.
 *
 * The forecast is two transparent, labelled projections — never a model's guess:
 *   - stage-weighted open pipeline (declared weights from lib/money.STAGE_WEIGHTS)
 *   - least-squares trend over the period's real buckets, marked "projected" per point
 */

export type ExportPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

export interface SeriesPoint { label: string; won: number; collected: number; projected?: boolean }

export interface ReportBundle {
  meta: {
    period: ExportPeriod;
    range: { start: string; end: string };
    prevRange: { start: string; end: string };
    base: string;
    timeZone: string;
    generatedAt: string;
    truncated: boolean;
    /** True when the window is a COMPLETED prior period (scheduled sends) rather than period-to-date. */
    complete: boolean;
    /** Present when the window matches a filed close snapshot — the immutable, hash-chained truth. */
    close?: { key: string; hash: string; drifted: boolean; changes: Record<string, { snapshot: number; live: number }> };
  };
  kpis: { label: string; kind: "flow" | "balance"; value: number; previous: number | null; delta: number | null; count?: number; note?: string }[];
  series: SeriesPoint[];
  forecastFrom: number | null;      // index in `series` where projection starts, null = no projection
  weightedPipelineForecast: number;
  pipelineByStage: { stage: string; count: number; value: number }[];
  topClosers: { owner: string; count: number; value: number }[];
  overdueAging: { bucket: string; count: number; total: number }[];
  openDeals: { name: string; stage: string; value: number; owner: string }[];
}

const DAY_MS = 86_400_000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Start of the local day containing `at`, in the workspace's calendar. */
function dayStart(at: Date, cfg: PeriodConfig): Date {
  const w = wallClock(at, cfg.timeZone);
  return instantOf({ year: w.year, month: w.month, day: w.day }, cfg.timeZone);
}

export function resolveRanges(
  period: ExportPeriod, cfg: PeriodConfig, now: Date,
  custom?: { start?: string; end?: string },
  /** Complete = the last FINISHED period (scheduled sends), compared full-against-full. */
  complete = false,
): { range: MsRange; prev: MsRange } {
  if (period === "custom") {
    const s = Date.parse(custom?.start ?? "");
    const e0 = Date.parse(custom?.end ?? "");
    if (!Number.isFinite(s) || !Number.isFinite(e0) || e0 < s) throw new Error("custom period needs valid start and end dates (YYYY-MM-DD, end ≥ start)");
    const e = e0 + DAY_MS - 1;               // end date is inclusive
    const len = e - s;
    return { range: { start: s, end: Math.min(e, now.getTime()) }, prev: { start: s - len - 1, end: s - 1 } };
  }
  if (period === "daily") {
    const todayStart = dayStart(now, cfg).getTime();
    if (complete) {
      // Yesterday, whole, against the day before it, whole.
      const yStart = dayStart(new Date(todayStart - DAY_MS / 2), cfg).getTime();
      const dbStart = dayStart(new Date(yStart - DAY_MS / 2), cfg).getTime();
      return { range: { start: yStart, end: todayStart - 1 }, prev: { start: dbStart, end: yStart - 1 } };
    }
    const offset = now.getTime() - todayStart;
    const prevStart = dayStart(new Date(todayStart - DAY_MS / 2), cfg).getTime();
    return { range: { start: todayStart, end: now.getTime() }, prev: { start: prevStart, end: prevStart + offset } };
  }
  const TYPE: Record<Exclude<ExportPeriod, "daily" | "custom">, PeriodType> = {
    weekly: "WEEKLY", monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY",
  };
  const type = TYPE[period];
  if (complete) {
    // The last finished period, whole, against the whole period before it — equal windows, so the
    // delta needs no same-point clamping.
    const last = previousPeriod(now, type, cfg);
    // The period CONTAINING the instant just before `last` starts — periodBounds, not
    // previousPeriod, which would skip one further back (June's previous is May).
    const before = periodBounds(new Date(last.start.getTime() - 1000), type, cfg);
    return {
      range: { start: last.start.getTime(), end: last.end.getTime() - 1 },
      prev: { start: before.start.getTime(), end: before.end.getTime() - 1 },
    };
  }
  const start = periodStart(now, type, cfg).getTime();
  const offset = now.getTime() - start;
  const prevBounds = previousPeriod(now, type, cfg);
  // Same distance into the previous period, clamped to its end (the 31st vs a 30-day month).
  return {
    range: { start, end: now.getTime() },
    prev: { start: prevBounds.start.getTime(), end: Math.min(prevBounds.start.getTime() + offset, prevBounds.end.getTime()) },
  };
}

/**
 * Expenses inside a window — the SAME population rule the period-close snapshot uses
 * (approved/verified only, dated by `date` → `approved_at` → created_at) so a report and a close
 * can never count different expenses. Valued from the frozen money fields when present, today's
 * rate otherwise (period-close.computeMetrics documents why the mixed basis is disclosed, not hidden).
 */
export function expensesIn(
  rows: NodeRow[],
  toBase: (amount: number, currency: string) => number,
  base: string,
  range: MsRange,
): { total: number; count: number } {
  let total = 0, count = 0;
  for (const r of rows) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const status = String(d.status ?? "").toLowerCase();
    if (status !== "approved" && status !== "verified") continue;
    const when = Date.parse(String(d.date ?? d.approved_at ?? r.created_at ?? ""));
    if (!Number.isFinite(when) || when < range.start || when > range.end) continue;
    const m = readMoney(d);
    const v = m.modelled && m.base_amount != null && (m.base_currency ?? "").toUpperCase() === base.toUpperCase()
      ? m.base_amount
      : toBase(m.amount, m.currency || base);
    total += v; count++;
  }
  return { total: r2(total), count };
}

/** Bucket granularity that keeps the chart readable at each period length. */
function granularity(period: ExportPeriod, range: MsRange): "day" | "week" | "month" {
  if (period === "daily" || period === "weekly" || period === "monthly") return "day";
  if (period === "quarterly") return "week";
  if (period === "yearly") return "month";
  const days = (range.end - range.start) / DAY_MS;
  return days <= 31 ? "day" : days <= 130 ? "week" : "month";
}

function bucketLabel(t: number, g: "day" | "week" | "month", cfg: PeriodConfig): string {
  const w = wallClock(new Date(t), cfg.timeZone);
  if (g === "month") return `${w.year}-${String(w.month).padStart(2, "0")}`;
  const iso = `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
  if (g === "day") return iso;
  // Week bucket: label by the workspace week's start day.
  const ws = periodStart(new Date(t), "WEEKLY", cfg);
  const sw = wallClock(ws, cfg.timeZone);
  return `wk ${sw.year}-${String(sw.month).padStart(2, "0")}-${String(sw.day).padStart(2, "0")}`;
}

/** Ordered, ZERO-FILLED buckets across the range — gaps are real zeros, not missing chart points. */
function buildBuckets(range: MsRange, g: "day" | "week" | "month", cfg: PeriodConfig): string[] {
  const labels: string[] = [];
  const stepDays = g === "day" ? 1 : g === "week" ? 7 : 28;
  let t = range.start;
  let guard = 0;
  while (t <= range.end && guard++ < 400) {
    const label = bucketLabel(t, g, cfg);
    if (labels[labels.length - 1] !== label) labels.push(label);
    t += stepDays * DAY_MS;
  }
  const last = bucketLabel(range.end, g, cfg);
  if (labels[labels.length - 1] !== last) labels.push(last);
  return labels;
}

/** Least-squares projection of the next `horizon` buckets from real values. */
export function projectSeries(values: number[], horizon: number): number[] {
  const n = values.length;
  if (n < 3) return [];
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (values[i]! - meanY); den += (i - meanX) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return Array.from({ length: horizon }, (_, k) => Math.max(0, r2(intercept + slope * (n + k))));
}

export async function composeWorkspaceReport(
  ws: string, period: ExportPeriod, custom?: { start?: string; end?: string }, now: Date = new Date(),
  opts: { complete?: boolean } = {},
): Promise<ReportBundle> {
  const complete = opts.complete ?? false;
  const { data: wsRow } = await supabase.from("workspaces").select("settings, timezone").eq("id", ws).maybeSingle();
  const cfg = workspacePeriodConfig(wsRow as { timezone?: unknown; settings?: unknown } | null);
  const { range, prev } = resolveRanges(period, cfg, now, custom, complete);

  const [deals, invoices, expenses, conv] = await Promise.all([
    pagedNodes(ws, { ilike: "%deal%" }),
    pagedNodes(ws, { eq: "invoice" }),
    pagedNodes(ws, { eq: "expense" }),
    makeBaseConverter(ws),
  ]);
  const { base, toBase } = conv;

  // ── KPIs — flow vs balance, deltas against the same point of the previous period ──
  const won = closedWonIn(deals, range), wonPrev = closedWonIn(deals, prev);
  const created = pipelineCreatedIn(deals, range), createdPrev = pipelineCreatedIn(deals, prev);
  const open = openPipeline(deals);
  const inv = invoiceMetrics(invoices, toBase, base, range);
  const invPrev = invoiceMetrics(invoices, toBase, base, prev);
  const exp = expensesIn(expenses, toBase, base, range);
  const expPrev = expensesIn(expenses, toBase, base, prev);
  const net = r2(inv.collected - exp.total);
  const netPrev = r2(invPrev.collected - expPrev.total);
  const weighted = r2(weightedForecast(deals));

  const kpis: ReportBundle["kpis"] = [
    { label: "Closed won", kind: "flow", value: r2(won.value), previous: r2(wonPrev.value), delta: deltaPct(won.value, wonPrev.value), count: won.count,
      note: won.undated ? `${won.undated} won deal${won.undated === 1 ? "" : "s"} carry no close date and are excluded from period figures (${r2(won.undated_value ?? 0)} ${base})` : undefined },
    { label: "Pipeline created", kind: "flow", value: r2(created.value), previous: r2(createdPrev.value), delta: deltaPct(created.value, createdPrev.value), count: created.count },
    { label: "Cash collected", kind: "flow", value: inv.collected, previous: invPrev.collected, delta: deltaPct(inv.collected, invPrev.collected) },
    { label: "Invoiced", kind: "flow", value: inv.invoiced, previous: invPrev.invoiced, delta: deltaPct(inv.invoiced, invPrev.invoiced) },
    { label: "Expenses", kind: "flow", value: exp.total, previous: expPrev.total, delta: deltaPct(exp.total, expPrev.total), count: exp.count,
      note: "approved/verified expenses only — the same population the period close counts" },
    { label: "Net cash (collected − expenses)", kind: "flow", value: net, previous: netPrev, delta: deltaPct(net, netPrev) },
    { label: "Open pipeline (now)", kind: "balance", value: r2(open.value), previous: null, delta: null, count: open.count },
    { label: "Outstanding AR (now)", kind: "balance", value: inv.outstanding, previous: null, delta: null },
    { label: "Overdue (now)", kind: "balance", value: inv.overdue.total, previous: null, delta: null, count: inv.overdue.count },
    { label: "Weighted pipeline forecast (now)", kind: "balance", value: weighted, previous: null, delta: null,
      note: "stage-weighted open pipeline — declared weights, not a prediction model" },
  ];

  // ── Series: won value + cash collected per bucket, zero-filled ──
  const g = granularity(period, range);
  const labels = buildBuckets(range, g, cfg);
  const byLabel = new Map(labels.map(l => [l, { won: 0, collected: 0 }]));
  for (const d of deals) {
    const wd = wonDate(d);
    if (!wd || !/won/i.test(dealStage(d.data))) continue;
    const t = Date.parse(wd);
    if (!Number.isFinite(t) || t < range.start || t > range.end) continue;
    const b = byLabel.get(bucketLabel(t, g, cfg));
    if (b) b.won = r2(b.won + dealValue(d.data));
  }
  for (const r of invoices) {
    const d = (r.data ?? {}) as Record<string, unknown>;
    if (String(d.status ?? "") !== "paid") continue;
    const t = Date.parse(String(d.paid_at ?? r.created_at));
    if (!Number.isFinite(t) || t < range.start || t > range.end) continue;
    const b = byLabel.get(bucketLabel(t, g, cfg));
    if (b) b.collected = r2(b.collected + toBase(Number(d.total ?? 0) || 0, String(d.currency ?? base)));
  }
  const series: SeriesPoint[] = labels.map(l => ({ label: l, ...byLabel.get(l)! }));

  // Projection only when there are enough REAL buckets to fit a line.
  const wonVals = series.map(s => s.won);
  const projected = projectSeries(wonVals, Math.min(3, Math.max(1, Math.floor(series.length / 3))));
  const forecastFrom = projected.length ? series.length : null;
  for (let k = 0; k < projected.length; k++) {
    series.push({ label: `+${k + 1}`, won: projected[k]!, collected: 0, projected: true });
  }

  // ── Structure tables ──
  const stages = new Map<string, { count: number; value: number }>();
  const openDeals: ReportBundle["openDeals"] = [];
  for (const d of deals) {
    const stage = dealStage(d.data);
    if (!isOpen(stage)) continue;
    const b = stages.get(stage) ?? { count: 0, value: 0 };
    b.count++; b.value = r2(b.value + dealValue(d.data));
    stages.set(stage, b);
    openDeals.push({
      name: String((d.data as Record<string, unknown> | null)?.name ?? (d.data as Record<string, unknown> | null)?.title ?? "Untitled"),
      stage, value: r2(dealValue(d.data)),
      owner: String((d.data as Record<string, unknown> | null)?.deal_owner ?? (d.data as Record<string, unknown> | null)?.assigned_to ?? "") || "Unassigned",
    });
  }
  openDeals.sort((a, b) => b.value - a.value);

  // ── Close alignment — only a COMPLETED calendar period can have a filed snapshot. When one
  // exists, the report carries its hash (the immutable, chain-linked truth) and, where the live
  // ledger has since moved, the drift — disclosed, never silently reconciled.
  let close: ReportBundle["meta"]["close"];
  if (complete && (period === "weekly" || period === "monthly" || period === "quarterly" || period === "yearly")) {
    const type = ({ weekly: "WEEKLY", monthly: "MONTHLY", quarterly: "QUARTERLY", yearly: "YEARLY" } as const)[period];
    const key = periodKey(new Date(range.start), type, cfg);
    try {
      const { data: snap } = await supabase
        .from("period_snapshots").select("hash")
        .eq("workspace_id", ws).eq("period_type", type).eq("period_key", key).maybeSingle();
      if (snap?.hash) {
        const drift = await driftFor(ws, type, key);
        close = { key, hash: String(snap.hash), drifted: drift?.drifted ?? false, changes: drift?.changes ?? {} };
      }
    } catch { /* a missing snapshot table must not block the report itself */ }
  }

  return {
    meta: {
      period,
      range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() },
      prevRange: { start: new Date(prev.start).toISOString(), end: new Date(prev.end).toISOString() },
      base, timeZone: cfg.timeZone, generatedAt: now.toISOString(),
      truncated: false,
      complete,
      ...(close ? { close } : {}),
    },
    kpis, series, forecastFrom,
    weightedPipelineForecast: weighted,
    pipelineByStage: [...stages].map(([stage, b]) => ({ stage, ...b })).sort((a, b) => b.value - a.value),
    topClosers: closersIn(deals as NodeRow[], range),
    overdueAging: inv.overdue.aging,
    openDeals: openDeals.slice(0, 200),
  };
}

// ── XLSX rendering ───────────────────────────────────────────────────────────────────────────────

export function reportToXlsx(b: ReportBundle): Uint8Array {
  const periodTitle = b.meta.period[0]!.toUpperCase() + b.meta.period.slice(1);
  const dt = (iso: string) => iso.slice(0, 10);
  const summary: XlsxSheet = {
    name: "Summary",
    rows: [
      ["Metric", "Type", `Value (${b.meta.base})`, "Previous period", "Δ %", "Count", "Note"],
      ...b.kpis.map(k => [k.label, k.kind, k.value, k.previous, k.delta, k.count ?? null, k.note ?? null] as (string | number | null)[]),
      [],
      [`${periodTitle} report`, null, null, null, null, null, null],
      ["Window", `${dt(b.meta.range.start)} → ${dt(b.meta.range.end)}`, null, null, null, null, null],
      ["Compared with", `${dt(b.meta.prevRange.start)} → ${dt(b.meta.prevRange.end)} (same distance into the previous period)`, null, null, null, null, null],
      ["Timezone", b.meta.timeZone, null, null, null, null, null],
      ["Generated", b.meta.generatedAt, null, null, null, null, null],
      ...(b.meta.close ? [
        ["Close snapshot", `${b.meta.close.key} · hash ${b.meta.close.hash.slice(0, 16)}…`, null, null, null, null, null],
        [b.meta.close.drifted
          ? `DRIFT since close: ${Object.entries(b.meta.close.changes).map(([k, v]) => `${k} ${v.snapshot} → ${v.live}`).join("; ")}`
          : "Recomputation agrees with the filed close snapshot", null, null, null, null, null, null],
      ] as (string | number | null)[][] : []),
    ],
  };
  const seriesSheet: XlsxSheet = {
    name: "Trend & forecast",
    rows: [
      ["Bucket", `Closed won (${b.meta.base})`, `Cash collected (${b.meta.base})`, "Projected?"],
      ...b.series.map(s => [s.label, s.won, s.collected, s.projected ? "projected (least-squares trend)" : null] as (string | number | null)[]),
    ],
  };
  const stagesSheet: XlsxSheet = {
    name: "Pipeline by stage",
    rows: [["Stage", "Open deals", `Value (${b.meta.base})`], ...b.pipelineByStage.map(s => [s.stage, s.count, s.value] as (string | number)[])],
  };
  const closersSheet: XlsxSheet = {
    name: "Top closers",
    rows: [["Owner", "Deals won", `Value (${b.meta.base})`], ...b.topClosers.map(c => [c.owner, c.count, c.value] as (string | number)[])],
  };
  const agingSheet: XlsxSheet = {
    name: "Overdue aging",
    rows: [["Bucket", "Invoices", `Total (${b.meta.base})`], ...b.overdueAging.map(a => [a.bucket, a.count, a.total] as (string | number)[])],
  };
  const dealsSheet: XlsxSheet = {
    name: "Open deals",
    rows: [["Deal", "Stage", `Value (${b.meta.base})`, "Owner"], ...b.openDeals.map(d => [d.name, d.stage, d.value, d.owner] as (string | number)[])],
  };
  return buildXlsx([summary, seriesSheet, stagesSheet, closersSheet, agingSheet, dealsSheet], new Date(b.meta.generatedAt));
}

// ── HTML rendering (self-contained, print-to-PDF friendly, inline SVG charts) ────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

function lineChartSvg(series: SeriesPoint[], forecastFrom: number | null): string {
  const W = 760, H = 220, PAD = 36;
  if (!series.length) return "";
  const max = Math.max(1, ...series.map(s => Math.max(s.won, s.collected)));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / Math.max(1, series.length - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (pick: (s: SeriesPoint) => number, upTo: number) =>
    series.slice(0, upTo).map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(pick(s)).toFixed(1)}`).join(" ");
  const solidEnd = forecastFrom ?? series.length;
  const wonSolid = path(s => s.won, solidEnd);
  const wonDash = forecastFrom
    ? series.slice(forecastFrom - 1).map((s, i) => `${i ? "L" : "M"}${x(forecastFrom - 1 + i).toFixed(1)},${y(s.won).toFixed(1)}`).join(" ")
    : "";
  const coll = path(s => s.collected, solidEnd);
  const ticks = [0, 0.5, 1].map(f => `<text x="4" y="${(y(max * f) + 4).toFixed(1)}" class="tick">${fmt(Math.round(max * f))}</text>`).join("");
  const labels = series.map((s, i) => (i % Math.ceil(series.length / 8) === 0 || s.projected)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 10}" class="tick" text-anchor="middle">${esc(s.label)}</text>` : "").join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Closed won and cash collected over the period">
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" class="axis"/>
    ${ticks}${labels}
    <path d="${coll}" class="line collected"/>
    <path d="${wonSolid}" class="line won"/>
    ${wonDash ? `<path d="${wonDash}" class="line won dash"/>` : ""}
  </svg>`;
}

function barChartSvg(rows: { stage: string; value: number }[]): string {
  if (!rows.length) return "";
  const W = 760, BAR = 26, GAP = 10, LABELW = 150;
  const H = rows.length * (BAR + GAP) + 10;
  const max = Math.max(1, ...rows.map(r => r.value));
  const bars = rows.map((r, i) => {
    const w = Math.max(2, ((W - LABELW - 90) * r.value) / max);
    const yy = i * (BAR + GAP) + 5;
    return `<text x="${LABELW - 8}" y="${yy + BAR / 2 + 4}" text-anchor="end" class="tick">${esc(r.stage)}</text>
      <rect x="${LABELW}" y="${yy}" width="${w.toFixed(1)}" height="${BAR}" rx="4" class="bar"/>
      <text x="${LABELW + w + 8}" y="${yy + BAR / 2 + 4}" class="tick">${fmt(r.value)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Open pipeline by stage">${bars}</svg>`;
}

export function reportToHtml(b: ReportBundle): string {
  const periodTitle = b.meta.period[0]!.toUpperCase() + b.meta.period.slice(1);
  const dt = (iso: string) => iso.slice(0, 10);
  const kpiCards = b.kpis.map(k => `
    <div class="kpi">
      <div class="kpi-label">${esc(k.label)}</div>
      <div class="kpi-value">${fmt(k.value)} <span class="ccy">${esc(b.meta.base)}</span></div>
      <div class="kpi-sub">${
        k.kind === "balance" ? "as of now"
        : k.delta == null ? (k.previous != null ? `prev ${fmt(k.previous)}` : "no prior-period base")
        : `${k.delta >= 0 ? "+" : ""}${k.delta}% vs same point last period (${fmt(k.previous ?? 0)})`
      }${k.count != null ? ` · ${k.count} record${k.count === 1 ? "" : "s"}` : ""}</div>
      ${k.note ? `<div class="kpi-note">${esc(k.note)}</div>` : ""}
    </div>`).join("");
  const table = (headers: string[], rows: (string | number)[][]) => rows.length
    ? `<table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
        rows.map(r => `<tr>${r.map((c, i) => `<td class="${typeof c === "number" ? "num" : ""}">${typeof c === "number" ? fmt(c) : esc(String(c))}</td>`).join("")}</tr>`).join("")
      }</tbody></table>`
    : `<p class="empty">No data in this window.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mondaily — ${esc(periodTitle)} report ${dt(b.meta.range.start)} → ${dt(b.meta.range.end)}</title>
<style>
  :root { --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#0e9f6e; --accent2:#3b82f6; }
  * { box-sizing:border-box; margin:0 }
  body { font:14px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif; color:var(--ink); background:#fff; max-width:820px; margin:0 auto; padding:32px 24px 64px }
  h1 { font-size:1.5rem; margin-bottom:2px } h2 { font-size:1.05rem; margin:32px 0 10px }
  .sub { color:var(--muted); font-size:.85rem; margin-bottom:24px }
  .kpis { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px }
  .kpi { border:1px solid var(--line); border-radius:10px; padding:12px 14px }
  .kpi-label { font-size:.75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em }
  .kpi-value { font-size:1.25rem; font-weight:600; margin-top:2px } .ccy { font-size:.75rem; color:var(--muted); font-weight:400 }
  .kpi-sub { font-size:.75rem; color:var(--muted) } .kpi-note { font-size:.72rem; color:#b45309; margin-top:4px }
  svg { width:100%; height:auto; margin-top:6px } .axis { stroke:var(--line) } .tick { font-size:10px; fill:var(--muted) }
  .line { fill:none; stroke-width:2 } .won { stroke:var(--accent) } .collected { stroke:var(--accent2) } .dash { stroke-dasharray:5 4 }
  .bar { fill:var(--accent); opacity:.85 }
  .legend { font-size:.75rem; color:var(--muted) } .legend b { font-weight:600 }
  .legend .sw { display:inline-block; width:10px; height:10px; border-radius:2px; margin:0 4px 0 12px; vertical-align:middle }
  table { width:100%; border-collapse:collapse; font-size:.85rem } th,td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--line) }
  th { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted) } td.num { text-align:right; font-variant-numeric:tabular-nums }
  .empty { color:var(--muted); font-size:.85rem }
  footer { margin-top:40px; font-size:.75rem; color:var(--muted); border-top:1px solid var(--line); padding-top:12px }
  @media print { body { padding:0 } .kpi { break-inside:avoid } h2 { break-after:avoid } }
</style></head><body>
<h1>${esc(periodTitle)} report${b.meta.complete ? " — completed period" : ""}</h1>
<div class="sub">${dt(b.meta.range.start)} → ${dt(b.meta.range.end)} · compared with ${dt(b.meta.prevRange.start)} → ${dt(b.meta.prevRange.end)} · ${esc(b.meta.timeZone)} · base ${esc(b.meta.base)}</div>
<div class="kpis">${kpiCards}</div>
<h2>Closed won &amp; cash collected</h2>
<div class="legend"><span class="sw" style="background:var(--accent)"></span><b>Closed won</b><span class="sw" style="background:var(--accent2)"></span><b>Cash collected</b>${b.forecastFrom ? ` · dashed = least-squares projection of the real trend` : ""}</div>
${lineChartSvg(b.series, b.forecastFrom)}
<h2>Open pipeline by stage (as of now)</h2>
${barChartSvg(b.pipelineByStage)}
<h2>Top closers</h2>
${table(["Owner", "Deals won", `Value (${b.meta.base})`], b.topClosers.map(c => [c.owner, c.count, c.value]))}
<h2>Overdue invoices — aging</h2>
${table(["Bucket", "Invoices", `Total (${b.meta.base})`], b.overdueAging.filter(a => a.count > 0).map(a => [a.bucket, a.count, a.total]))}
<h2>Open deals</h2>
${table(["Deal", "Stage", `Value (${b.meta.base})`, "Owner"], b.openDeals.slice(0, 50).map(d => [d.name, d.stage, d.value, d.owner]))}
<footer>${b.meta.close ? `Filed close snapshot <b>${esc(b.meta.close.key)}</b> (hash ${esc(b.meta.close.hash.slice(0, 16))}…): ${b.meta.close.drifted ? `the live ledger has moved since the close — ${Object.entries(b.meta.close.changes).map(([k, v]) => `${esc(k)} ${fmt(v.snapshot)} → ${fmt(v.live)}`).join("; ")} (disclosed, not reconciled).` : "recomputation agrees with the filed figures."}<br/>` : ""}Generated by Mondaily on ${b.meta.generatedAt.slice(0, 16).replace("T", " ")} UTC. Flow metrics are counted inside the window; balance metrics are as of generation time. Projections are transparent least-squares extensions of the real series — labelled, never blended into actuals.</footer>
</body></html>`;
}
