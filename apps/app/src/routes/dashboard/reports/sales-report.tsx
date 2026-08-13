import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect } from "react";
import { LogoMark } from "@/components/logo";
import {
  Printer, TrendingUp, TrendingDown, Minus, ArrowLeft, ChevronDown,
  Download, Target, X, ChevronRight, Filter, Loader2, AlertCircle, Mail, Plus, Trash2, Bookmark,
  Database, UploadCloud, Radar, BarChart2,
} from "lucide-react";
import { EmptyState } from "../../../components/ui/page-state";
import { useNavigate } from "react-router-dom";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";
import { FieldSelect, FilterButton } from "../../../components/ui/controls";
import { SegmentedControl } from "../../../components/ui/segmented";
import { useCurrency, convertAmount, currencyOptions, CURRENCY_SYMBOL } from "../../../hooks/useCurrency";
import { useRecordAggregate, type AggDateFilter, type AggFilter } from "../../../hooks/useRecordAggregate";
import { DateField } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { errorText } from "../../../lib/alerts";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; created_at?: string; updated_at?: string }

type Period = "today" | "week" | "month" | "quarter" | "year" | "custom";

// ─── Auto-detect column semantics ─────────────────────────────────────────────
function detectValueCol(records: NodeRecord[]): string | null {
  const candidates = ["deal_value","value","amount","price","revenue","arr","budget","salary","cost","total","fee","rate"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  return keys.find(k => records.some(r => r.data[k] != null && !isNaN(Number(r.data[k])) && Number(r.data[k]) > 0)) ?? null;
}
function detectStageCol(records: NodeRecord[]): string | null {
  const candidates = ["deal_stage","stage","status","phase","state","pipeline_stage","step","category","priority"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  return null;
}
function detectNameCol(records: NodeRecord[]): string {
  const candidates = ["name","title","deal_name","company","contact","project","client","property"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  return keys[0] ?? "name";
}

// ─── Stage classification ──────────────────────────────────────────────────────
const WON_KEYWORDS  = ["won","closed won","win","closed","completed","converted","success","done","delivered","paid","approved","active"];
const LOST_KEYWORDS = ["lost","closed lost","rejected","declined","dead","churned","cancelled","failed","expired"];
// LOST is checked FIRST and wins. The bare "closed" in WON_KEYWORDS matches "Closed Lost", so
// isWon("Closed Lost") and isLost("Closed Lost") were BOTH true: lost deals had their value added
// to Won Value, and a workspace with 0 won / 5 lost reported a 50% completion rate. The wrong
// wonValue also fed the AI forecast prompt and the printed PDF.
function isLost(stage: string) { return LOST_KEYWORDS.some(k => stage.toLowerCase().includes(k)); }
function isWon(stage: string)  { return !isLost(stage) && WON_KEYWORDS.some(k => stage.toLowerCase().includes(k)); }
function isOpen(stage: string) { return !isWon(stage) && !isLost(stage); }

// Phase 3f — reconstruct the stage-derived KPIs from ONE grouped server aggregate (group_by=stageCol).
// The backend stays generic: it only groups by the raw stage column. ALL won/lost/open classification
// happens HERE with the SAME isWon/isLost/isOpen used client-side, so the numbers match today's logic
// exactly — just computed over the full (date+filter-scoped, capped) table instead of the 500-row page.
type StageGroup = { label: string; value: number; count: number; unconverted: number };
function deriveStageStats(groups: StageGroup[], hasValue: boolean) {
  let wonValue = 0, openValue = 0, wonCount = 0, lostCount = 0, openCount = 0, totalValue = 0, totalCount = 0, unconverted = 0;
  for (const g of groups) {
    const val = hasValue ? g.value : 0; // for op:"count", g.value === g.count (not money) — ignore as value
    totalCount += g.count; totalValue += val; unconverted += g.unconverted;
    if (isWon(g.label))  { wonValue += val; wonCount += g.count; }
    if (isLost(g.label)) { lostCount += g.count; }
    if (isOpen(g.label)) { openValue += val; openCount += g.count; }
  }
  const completionRate = (wonCount + lostCount) > 0 ? Math.round(wonCount / (wonCount + lostCount) * 100) : 0;
  const avgVal = wonCount ? Math.round(wonValue / wonCount) : (totalCount ? Math.round(totalValue / totalCount) : 0);
  return { wonValue, openValue, wonCount, lostCount, openCount, totalValue, totalCount, completionRate, avgVal, unconverted };
}

// Currency symbol defaults to "$" so any untouched caller keeps working; the report threads the
// workspace's real display symbol (from useCurrency) through so £/€ workspaces never see "$".
function fmtMoney(n: number, sym = "$") {
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(0)}K`;
  return `${sym}${n.toLocaleString()}`;
}
function fmtNum(n: number) { return n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n); }

// Honest inline empty state for value charts — a value column exists but every bucket is zero.
// Better than a flat line at the floor, which reads as a real (misleadingly empty) trend.
function NoValueData({ col }: { col?: string | null }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-1.5 text-center">
      <BarChart2 size={18} style={{ color: "var(--text-faint)" }} />
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>No value data for this view</span>
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        {col ? <>Records in this period have no <span className="tabular-nums">{col}</span> amounts — </> : "These records carry no numeric value — "}
        counts are still charted above.
      </span>
    </div>
  );
}

function Sparkline({ values, height = 220 }: { values: number[]; height?: number }) {
  const clean = values.map(v => Number.isFinite(v) ? v : 0);
  const min = Math.min(...clean, 0);
  const max = Math.max(...clean, 1);
  const range = Math.max(max - min, 1);
  const points = clean.length <= 1
    ? "0,50 100,50"
    : clean.map((value, index) => {
      const x = (index / (clean.length - 1)) * 100;
      const y = 88 - ((value - min) / range) * 76;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");

  return (
    <div className="rounded-sm bg-[var(--surface-card)] p-5 print:bg-white" style={{ height }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <polyline
          points={points}
          fill="none"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="minimal-sparkline stroke-current"
          strokeWidth="1.6"
        />
      </svg>
    </div>
  );
}

function periodStart(p: Period): Date {
  const d = new Date();
  if (p === "today")   { d.setHours(0,0,0,0); return d; }
  if (p === "week")    { d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; }
  if (p === "month")   { d.setDate(1); d.setHours(0,0,0,0); return d; }
  if (p === "quarter") { d.setMonth(Math.floor(d.getMonth()/3)*3, 1); d.setHours(0,0,0,0); return d; }
  if (p === "custom")  return new Date(0);
  d.setMonth(0,1); d.setHours(0,0,0,0); return d;
}

function prevPeriodRange(p: Exclude<Period, "custom">): { start: Date; end: Date } {
  const currStart = periodStart(p);
  const now = new Date();
  const durationMs = now.getTime() - currStart.getTime();
  return { start: new Date(currStart.getTime() - durationMs), end: currStart };
}

function bucketLabel(date: Date, p: Period): string {
  if (p === "today")   return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (p === "week")    return date.toLocaleDateString([], { weekday: "short" });
  if (p === "month")   return date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (p === "quarter") return `${date.toLocaleDateString([], { month: "short" })} W${Math.ceil(date.getDate()/7)}`;
  if (p === "custom")  return date.toLocaleDateString([], { month: "short", day: "numeric" });
  return date.toLocaleDateString([], { month: "short" });
}

function buildTrend(records: NodeRecord[], valueCol: string | null, stageCol: string | null, period: Period, customRange?: { start: Date; end: Date }, toDisplay?: ValueReader) {
  const start = customRange ? customRange.start : (period === "custom" ? new Date(0) : periodStart(period));
  // Buckets keep the earliest timestamp seen so the series can be ordered chronologically.
  // Sorting by the LABEL (localeCompare) put a year in the order Apr, Aug, Dec, Feb, Jan… and
  // a month in the order "Mar 12" before "Mar 3" — a rising series could render as falling.
  const buckets: Map<string, { revenue: number; count: number; at: number }> = new Map();
  for (const r of records) {
    const raw = r.updated_at ?? r.created_at ?? (r.data as Record<string,unknown>).created_at ?? (r.data as Record<string,unknown>).updated_at;
    if (!raw) continue;
    const d = new Date(raw as string);
    if (d < start) continue;
    if (customRange && d > customRange.end) continue;
    const stage = stageCol ? String(r.data[stageCol] ?? "") : "";
    const rawVal = valueCol ? Number(r.data[valueCol] ?? 0) : 0;
    const val   = toDisplay ? toDisplay(isNaN(rawVal) ? 0 : rawVal, (r.data.currency as string | undefined) ?? null) : rawVal;
    const label = bucketLabel(d, period);
    const existing = buckets.get(label) ?? { revenue: 0, count: 0, at: d.getTime() };
    existing.at = Math.min(existing.at, d.getTime());
    if (!stageCol || isWon(stage)) { existing.revenue += isNaN(val) ? 0 : val; existing.count += 1; }
    buckets.set(label, existing);
  }
  return Array.from(buckets.entries())
    .sort(([, a], [, b]) => a.at - b.at)
    .map(([label,{revenue,count}]) => ({ label, revenue, count }));
}

// A per-record value reader that optionally converts the raw amount from the record's own currency
// (data.currency, else the workspace base) into the caller's display currency. When no converter is
// supplied it returns the raw number — so untouched callers are unchanged.
type ValueReader = (raw: number, recordCurrency: string | null) => number;
function computeStats(records: NodeRecord[], valueCol: string | null, stageCol: string | null, period: Period, rangeOverride?: { start: Date; end: Date }, toDisplay?: ValueReader) {
  const start = rangeOverride ? rangeOverride.start : periodStart(period);
  const end   = rangeOverride ? rangeOverride.end   : new Date();
  const inPeriod = records.filter(r => {
    const raw = r.updated_at ?? r.created_at ?? (r.data as Record<string,unknown>).updated_at ?? (r.data as Record<string,unknown>).created_at;
    if (!raw) return !rangeOverride;
    const d = new Date(raw as string);
    return d >= start && d <= end;
  });
  const getVal   = (r: NodeRecord) => { const v = valueCol ? r.data[valueCol] : undefined; const n = Number(v ?? 0); if (isNaN(n)) return 0; return toDisplay ? toDisplay(n, (r.data.currency as string | undefined) ?? null) : n; };
  const getStage = (r: NodeRecord) => stageCol ? String(r.data[stageCol] ?? "") : "";

  const wonRecs  = stageCol ? inPeriod.filter(r => isWon(getStage(r)))  : inPeriod;
  const lostRecs = stageCol ? inPeriod.filter(r => isLost(getStage(r))) : [];
  const openRecs = stageCol ? inPeriod.filter(r => isOpen(getStage(r))) : [];

  const totalValue   = inPeriod.reduce((s,r) => s + getVal(r), 0);
  const wonValue     = wonRecs.reduce((s,r) => s + getVal(r), 0);
  const openValue    = openRecs.reduce((s,r) => s + getVal(r), 0);
  const completionRate = (wonRecs.length + lostRecs.length) > 0
    ? Math.round(wonRecs.length / (wonRecs.length + lostRecs.length) * 100) : 0;
  const avgVal = wonRecs.length ? Math.round(wonValue / wonRecs.length) : (inPeriod.length ? Math.round(totalValue / inPeriod.length) : 0);

  return { totalValue, wonValue, openValue, completionRate, avgVal, wonCount: wonRecs.length, openCount: openRecs.length, totalCount: inPeriod.length };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round((curr - prev) / prev * 100);
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function DeltaBadge({ delta }: { delta: number | null | undefined }) {
  if (delta == null) return null;
  const up = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${up ? "bg-[#2f9e6b]/10 text-[#2f9e6b] border-[#2f9e6b]/25" : "bg-stone-500/10 text-[var(--text-secondary)] border-stone-500/20"}`}>
      {up ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}
      {up ? "+" : ""}{delta}%
    </span>
  );
}

function GoalBar({ value, goal, sym = "$" }: { value: number; goal: number; sym?: string }) {
  // goal can be 0 (read from a KPI card, not just the guarded saveGoal): 0/0 -> NaN -> "NaN% of
  // goal" and style width:"NaN%"; x/0 -> Infinity -> 100%.
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-[var(--text-secondary)] mb-1">
        <span>{pct}% of goal</span>
        <span>{fmtMoney(goal, sym)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--surface-hover)]">
        <div className="h-1.5 rounded-full bg-current transition-all" style={{ width: `${pct}%` }}/>
      </div>
    </div>
  );
}

// Executive KPI cell — a cohesive neutral surface with a thin toned left-accent (no per-card candy
// background). `primary` renders the headline metrics larger; secondary metrics are compact, so the
// strip reads as one hierarchy instead of six equal floating cards. Values/calcs are unchanged.
function KpiCard({ label, value, sub, tone, trend, delta, goal, goalValue, onSetGoal, sym = "$", primary }: {
  label: string; value: string; sub?: string; tone: string; trend?: "up"|"down"|"neutral";
  delta?: number | null; goal?: number | null; goalValue?: number; onSetGoal?: () => void; sym?: string; primary?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden rounded-sm border print:border-[var(--border-soft)] ${primary ? "p-4" : "p-3.5"}`}
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", borderLeft: `2px solid ${tone}` }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-body" style={{ color: tone }}>{label}</p>
        {onSetGoal && (
          <button onClick={onSetGoal} title="Set goal" className="opacity-30 hover:opacity-60 transition-opacity print:hidden" style={{ color: tone }}>
            <Target size={12}/>
          </button>
        )}
      </div>
      <p className={`mt-1.5 font-bold text-[var(--text-primary)] leading-none tabular-nums print:text-black ${primary ? "text-[26px]" : "text-xl"}`}>{value}</p>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {delta != null && <DeltaBadge delta={delta}/>}
        {sub && (
          <div className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] print:text-[var(--text-muted)]">
            {trend === "up"      && <TrendingUp  size={11} className="text-[#2f9e6b]"/>}
            {trend === "down"    && <TrendingDown size={11} className="text-[var(--text-secondary)]"/>}
            {trend === "neutral" && <Minus size={11}/>}
            {sub}
          </div>
        )}
      </div>
      {goal != null && goalValue != null && <GoalBar value={goalValue} goal={goal} sym={sym}/>}
    </div>
  );
}

function ObjectPicker({ objects, value, onChange }: {
  objects: Array<{ slug: string; name_plural: string }>;
  value: string;
  onChange: (slug: string) => void;
}) {
  // Shared FieldSelect (required selection — no injected "All" row), same chrome as every other
  // form select in the app. Compact width for the report header.
  return (
    <div className="w-44">
      <FieldSelect
        value={value}
        onChange={onChange}
        ariaLabel="Report object type"
        options={objects.map(o => ({ value: o.slug, label: o.name_plural }))}
      />
    </div>
  );
}

function DrillPanel({ record, nameCol, onClose }: { record: NodeRecord; nameCol: string; onClose: () => void }) {
  const name = String(record.data[nameCol] ?? "Record");
  const fields = Object.entries(record.data).filter(([,v]) => v != null && v !== "");
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div className="w-full max-w-md overflow-y-auto bg-[var(--surface-card)] border-l border-[var(--border-soft)] p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-semibold text-[var(--text-primary)] truncate">{name}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <X size={16}/>
          </button>
        </div>
        <div className="space-y-3">
          {fields.map(([key, val]) => (
            <div key={key} className="flex items-start gap-3">
              <span className="min-w-[120px] text-body text-[var(--text-secondary)] pt-0.5">{key}</span>
              <span className="text-sm text-[var(--text-faint)] break-all">{String(val)}</span>
            </div>
          ))}
          <div className="pt-3 border-t border-[var(--border-soft)]">
            <div className="flex items-start gap-3">
              <span className="min-w-[120px] text-body text-[var(--text-secondary)] pt-0.5">Created</span>
              <span className="text-sm text-[var(--text-faint)]">{record.created_at ? new Date(record.created_at).toLocaleString() : "—"}</span>
            </div>
            <div className="flex items-start gap-3 mt-2">
              <span className="min-w-[120px] text-body text-[var(--text-secondary)] pt-0.5">Updated</span>
              <span className="text-sm text-[var(--text-faint)]">{record.updated_at ? new Date(record.updated_at).toLocaleString() : "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI Modal shell ───────────────────────────────────────────────────────────
function AIModal({ title, onClose, onPrint, children }: { title: string; onClose: () => void; onPrint?: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <Modal title={title} width="lg" onClose={onClose}
      headerAction={onPrint ? (
        <button onClick={onPrint}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 text-label text-[var(--text-faint)] transition-colors hover:text-[var(--text-primary)]">
          <Printer size={11}/> Export
        </button>
      ) : undefined}>
        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
    </Modal>
  );
}

// ─── AI Forecast Card ─────────────────────────────────────────────────────────
interface ForecastAction { action: string; impact: "high"|"medium"|"low"; why: string }
interface ForecastResult { projectedValue: number; confidence: "high"|"medium"|"low"; headline: string; narrative: string; risks: string; actions?: ForecastAction[] }

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   "border-[#2f9e6b]/25 bg-[#2f9e6b]/10 text-[#2f9e6b]",
  medium: "border-[#c6892e]/25 bg-[#c6892e]/10 text-[#c6892e]",
  low:    "border-stone-500/30 bg-stone-600/10 text-[var(--text-secondary)]",
};

function AIForecastCard({ objectType, valueCol, stageCol, period, stats, prevStats, trendData, sym = "$" }: {
  objectType: string; valueCol: string | null; stageCol: string | null; period: Period;
  stats: ReturnType<typeof computeStats>; prevStats: ReturnType<typeof computeStats>;
  trendData: { label: string; revenue: number; count: number }[]; sym?: string;
}) {
  // Persist the real forecast per (objectType, period, valueCol) in the query cache so it survives
  // remounts/tab-switches and renders instantly on return — "already done", not a button you must
  // re-press (and re-spend on). A run only happens on explicit Generate/Regenerate.
  const qc = useQueryClient();
  const cacheKey = useMemo(() => ["report-forecast", objectType, period, valueCol ?? "count"], [objectType, period, valueCol]);
  const [result, setResult]   = useState<ForecastResult | null>(() => qc.getQueryData<ForecastResult>(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const hasValue = !!valueCol;
  // Re-seed from cache when the report's object/period/value changes (each has its own cached forecast).
  useEffect(() => { setResult(qc.getQueryData<ForecastResult>(cacheKey) ?? null); setError(null); }, [cacheKey, qc]);

  async function runForecast() {
    setLoading(true); setError(null);
    try {
      const res = await apiClient.post<ForecastResult>("/generate/forecast", {
        objectType, valueCol, stageCol, period,
        stats: { wonValue: stats.wonValue, openValue: stats.openValue, wonCount: stats.wonCount, openCount: stats.openCount, totalCount: stats.totalCount, completionRate: stats.completionRate, avgVal: stats.avgVal },
        prevStats: { wonValue: prevStats.wonValue, wonCount: prevStats.wonCount, completionRate: prevStats.completionRate },
        trendData,
      });
      setResult(res); qc.setQueryData(cacheKey, res);
    } catch (e: any) {
      setError(errorText(e, "Forecast unavailable.")); setModalOpen(false);
    } finally { setLoading(false); }
  }

  function printForecast() {
    if (!result) return;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>AI Forecast</title>
<style>body{font-family:-apple-system,sans-serif;color:#111;max-width:640px;margin:48px auto;padding:0 32px}
h1{font-size:22px;font-weight:700;margin-bottom:4px}
.meta{font-size:12px;color:#6b7280;margin-bottom:32px}
.big{font-size:36px;font-weight:800;color:#111;margin:20px 0 4px}
.label{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af}
.badge{display:inline-block;border-radius:99px;border:1px solid;padding:2px 10px;font-size:11px;font-weight:600;margin-bottom:20px}
.high{border-color:#6ee7b7;color:#059669;background:#ecfdf5}
.medium{border-color:#fcd34d;color:#c6892e;background:#fffbeb}
.low{border-color:#fca5a5;color:#d1524a;background:#fef2f2}
.section{margin-bottom:20px}
.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:6px}
p{font-size:13px;color:#374151;line-height:1.6}
.risk{background:#fffbeb;border-left:3px solid #c6892e;padding:10px 14px;border-radius:4px;font-size:12px;color:#92400e}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
</style></head><body>
<h1>AI Forecast</h1>
<p class="meta">${objectType} · ${PERIOD_LABELS[period]} · Generated ${new Date().toLocaleDateString([], {year:"numeric",month:"long",day:"numeric"})}</p>
<div class="label">Projected ${hasValue ? "Revenue" : "Completions"}</div>
<div class="big">${hasValue ? fmtMoney(result.projectedValue, sym) : fmtNum(result.projectedValue)}</div>
<span class="badge ${result.confidence}">${result.confidence.charAt(0).toUpperCase()+result.confidence.slice(1)} Confidence</span>
<div class="section"><div class="section-title">Headline</div><p><em>${result.headline}</em></p></div>
<div class="section"><div class="section-title">Analysis</div><p>${result.narrative}</p></div>
${result.risks && result.risks !== "None identified" ? `<div class="risk"><strong>Risk:</strong> ${result.risks}</div>` : ""}
${result.actions && result.actions.length > 0 ? `<div class="section" style="margin-top:24px"><div class="section-title">What to do now</div><div style="display:flex;flex-direction:column;gap:8px">${result.actions.map(a=>`<div style="display:flex;align-items:flex-start;gap:10px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px"><span style="font-size:9px;font-weight:700;border-radius:99px;border:1px solid;padding:2px 8px;white-space:nowrap;${a.impact==="high"?"border-color:#6ee7b7;color:#059669;background:#ecfdf5":a.impact==="medium"?"border-color:#fcd34d;color:#c6892e;background:#fffbeb":"border-color:#d1d5db;color:#6b7280;background:#f9fafb"}">${a.impact}</span><div><div style="font-size:13px;font-weight:600;color:#111;margin-bottom:2px">${a.action}</div><div style="font-size:11px;color:#6b7280">${a.why}</div></div></div>`).join("")}</div></div>` : ""}
<div class="footer"><span>Mondaily AI · AI Forecast</span><span>${new Date().toLocaleDateString()}</span></div>
<script>window.onload=()=>window.print()<\/script></body></html>`;
    const w = window.open("","_blank"); if(w){w.document.write(html);w.document.close();}
  }

  return (
    <>
      <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] print:hidden">
        {/* Header row — the agent, its state, and refresh/expand once a real forecast exists. */}
        <div className="flex items-center gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[var(--section-accent-soft)] ring-1 ring-[var(--section-accent-line)]">
            <LogoMark size={16} className="text-[var(--section-accent)]"/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">AI Forecast</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {result ? `Projecting ${hasValue?"revenue":"completions"} · ${PERIOD_LABELS[period]}` : `Project ${hasValue?"revenue":"completions"} with Mondaily AI`}
            </p>
          </div>
          {loading ? (
            <Loader2 size={15} className="animate-spin text-[var(--section-accent)] shrink-0"/>
          ) : error ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-faint)] max-w-[160px] truncate">{error}</span>
              <button onClick={() => { setError(null); runForecast(); }} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Retry</button>
            </div>
          ) : result ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => setModalOpen(true)} title="Full analysis" className="btn-secondary px-2.5 py-1.5 text-xs">Expand</button>
              <button onClick={runForecast} title="Regenerate" className="btn-secondary px-2.5 py-1.5 text-xs">↺</button>
            </div>
          ) : (
            <button onClick={runForecast} className="btn-primary shrink-0 px-3.5 py-1.5 text-xs font-semibold">
              Generate
            </button>
          )}
        </div>
        {/* Data scope BEFORE a run — the real inputs the agent will use (honest proof-of-work, no
            result implied until Generate is pressed). Hidden once a real forecast exists. */}
        {!result && !loading && !error && (
          <div className="border-t border-[var(--border-soft)] px-5 py-2.5 text-[11px] text-[var(--text-muted)]">
            Will analyse <span className="font-medium text-[var(--text-secondary)] tabular-nums">{stats.totalCount}</span> {objectType} · {PERIOD_LABELS[period]}{valueCol ? ` · by ${valueCol}` : " · by count"} — grounded in your real records; nothing is generated until you run it.
          </div>
        )}
        {/* Inline result — the forecast lives ON the page (no click-to-modal for the primary read). */}
        {result && !loading && (
          <div className="border-t border-[var(--border-soft)] px-5 py-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-body text-[var(--text-muted)]">Projected {hasValue ? "revenue" : "completions"}</p>
                <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight mt-0.5">{hasValue ? fmtMoney(result.projectedValue, sym) : fmtNum(result.projectedValue)}</p>
              </div>
              <span className={`shrink-0 inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize ${CONFIDENCE_STYLE[result.confidence] ?? CONFIDENCE_STYLE.medium}`}>{result.confidence} confidence</span>
            </div>
            <p className="mt-2 text-[12px] italic text-[var(--text-faint)] leading-relaxed">{result.headline}</p>
            {result.actions && result.actions[0] && (
              <div className="mt-3 flex items-start gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2">
                <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold border ${result.actions[0].impact === "high" ? "border-[#2f9e6b]/25 bg-[#2f9e6b]/10 text-[#2f9e6b]" : result.actions[0].impact === "medium" ? "border-[#c6892e]/25 bg-[#c6892e]/10 text-[#c6892e]" : "border-stone-500/30 bg-stone-600/10 text-[var(--text-secondary)]"}`}>{result.actions[0].impact}</span>
                <p className="text-[11.5px] text-[var(--text-secondary)] leading-snug"><span className="font-medium text-[var(--text-primary)]">{result.actions[0].action}.</span> {result.actions[0].why}</p>
              </div>
            )}
            {result.actions && result.actions.length > 1 && (
              <button onClick={() => setModalOpen(true)} className="mt-2 text-[11px] font-medium text-[var(--section-accent)] hover:underline">+{result.actions.length - 1} more {result.actions.length - 1 === 1 ? "action" : "actions"} & full analysis →</button>
            )}
          </div>
        )}
      </div>

      {/* Result modal */}
      {modalOpen && result && (
        <AIModal title="AI Forecast" onClose={() => setModalOpen(false)} onPrint={printForecast}>
          {/* Projected value hero */}
          <div className="px-6 py-6 border-b border-[var(--border-soft)]">
            <p className="text-body text-[var(--text-muted)] mb-1">Projected {hasValue ? "Revenue" : "Completions"}</p>
            <p className="text-4xl font-bold text-[var(--text-primary)] mb-2">{hasValue ? fmtMoney(result.projectedValue, sym) : fmtNum(result.projectedValue)}</p>
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${CONFIDENCE_STYLE[result.confidence] ?? CONFIDENCE_STYLE.medium}`}>
              {result.confidence} confidence
            </span>
          </div>
          {/* Headline */}
          <div className="px-6 py-4 border-b border-[var(--border-soft)]">
            <p className="text-body text-[var(--text-secondary)] mb-1.5">Headline</p>
            <p className="text-sm text-[var(--text-faint)] italic leading-relaxed">{result.headline}</p>
          </div>
          {/* Narrative */}
          <div className="px-6 py-4 border-b border-[var(--border-soft)]">
            <p className="text-body text-[var(--text-secondary)] mb-1.5">Analysis</p>
            <p className="text-sm text-[var(--text-faint)] leading-relaxed">{result.narrative}</p>
          </div>
          {/* Risk */}
          {result.risks && result.risks !== "None identified" && (
            <div className="mx-6 my-4 flex items-start gap-3 rounded-sm border border-[#c6892e]/25 bg-[#c6892e]/[.06] px-4 py-3">
              <AlertCircle size={14} className="text-[#c6892e] shrink-0 mt-0.5"/>
              <div>
                <p className="text-body text-[#c6892e] mb-0.5">Risk</p>
                <p className="text-sm text-[#c6892e]/80 leading-relaxed">{result.risks}</p>
              </div>
            </div>
          )}
          {/* Actions */}
          {result.actions && result.actions.length > 0 && (
            <div className="px-6 py-4 border-t border-[var(--border-soft)]">
              <p className="text-body text-[var(--text-secondary)] mb-3">What to do now</p>
              <div className="space-y-2">
                {result.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-4 py-3">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      a.impact === "high"   ? "border-[#2f9e6b]/25 bg-[#2f9e6b]/10 text-[#2f9e6b]" :
                      a.impact === "medium" ? "border-[#c6892e]/25 bg-[#c6892e]/10 text-[#c6892e]" :
                                              "border-stone-500/30 bg-stone-600/10 text-[var(--text-secondary)]"
                    }`}>{a.impact}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--text-primary)] font-medium">{a.action}</p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{a.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="px-6 py-3 flex items-center justify-between border-t border-[var(--border-soft)]">
            <span className="text-[10px] text-[var(--text-secondary)]">Powered by Mondaily AI</span>
            <button onClick={() => { setResult(null); setModalOpen(false); runForecast(); }} className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors">↺ Regenerate</button>
          </div>
        </AIModal>
      )}
    </>
  );
}

interface AIInsight { title: string; value: string; trend?: "up"|"down"|"neutral"; description: string; category: "performance"|"risk"|"opportunity"|"summary"; action?: string }

function AIInsightsPanel({ records, objectType }: { records: NodeRecord[]; objectType: string }) {
  // Cache insights per object type in the query cache so they persist across remounts and render
  // instantly on return (no silent re-run/re-spend). A run happens only on explicit Analyse/Regenerate.
  const qc = useQueryClient();
  const cacheKey = useMemo(() => ["report-insights", objectType], [objectType]);
  const [loading, setLoading]   = useState(false);
  const [insights, setInsights] = useState<AIInsight[] | null>(() => qc.getQueryData<AIInsight[]>(cacheKey) ?? null);
  const [error, setError]       = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const CATEGORY_META = {
    performance: { label: "Performance", dot: "bg-[#2f9e6b]", border: "border-[#2f9e6b]/25", bg: "bg-[#2f9e6b]/[.06]", text: "text-[#2f9e6b]" },
    opportunity: { label: "Opportunity", dot: "bg-[#717784]",    border: "border-[#717784]/25",    bg: "bg-[#717784]/[.06]",    text: "text-[#717784]"    },
    risk:        { label: "Risk",        dot: "bg-stone-400",     border: "border-stone-500/25",     bg: "bg-stone-500/[.06]",     text: "text-[var(--text-secondary)]"     },
    summary:     { label: "Summary",     dot: "bg-stone-400",  border: "border-stone-500/25",  bg: "bg-stone-500/[.06]",  text: "text-[var(--text-secondary)]"  },
  } as const;
  type Cat = keyof typeof CATEGORY_META;
  const fallbackMeta = CATEGORY_META.summary;

  // Re-seed from cache when the analysed object type changes (each type has its own cached insights).
  useEffect(() => {
    setInsights(qc.getQueryData<AIInsight[]>(cacheKey) ?? null);
    setError(null);
    setModalOpen(false);
  }, [cacheKey, qc]);

  async function run() {
    setLoading(true); setError(null);
    try {
      const res = await apiClient.post<{ insights: AIInsight[] }>("/generate/insights", { objectType, records: records.slice(0, 50) });
      const list = res.insights ?? [];
      setInsights(list); qc.setQueryData(cacheKey, list);
    } catch (e: any) {
      setError(errorText(e, "Could not load AI insights."));
    } finally { setLoading(false); }
  }

  function printInsights() {
    if (!insights) return;
    const cards = insights.map(ins => {
      const cat = ins.category as Cat;
      const colors: Record<Cat, string> = { performance:"#2f9e6b", opportunity:"#717784", risk:"#d1524a", summary:"var(--section-accent)" };
      const c = colors[cat] ?? colors.summary;
      return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;break-inside:avoid">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${c};margin-bottom:4px">${ins.category}</div>
        <div style="font-size:11px;color:#6b7280;margin-bottom:2px">${ins.title}</div>
        <div style="font-size:22px;font-weight:800;color:#111;margin-bottom:6px">${ins.value}</div>
        <div style="font-size:12px;color:#374151;line-height:1.5">${ins.description}</div>
        ${ins.action ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280"><span style="color:#9ca3af;margin-right:4px">→</span>${ins.action}</div>` : ""}
      </div>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>AI Insights</title>
<style>body{font-family:-apple-system,sans-serif;color:#111;max-width:700px;margin:48px auto;padding:0 32px}
h1{font-size:22px;font-weight:700;margin-bottom:4px}.meta{font-size:12px;color:#6b7280;margin-bottom:28px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
</style></head><body>
<h1>AI Insights</h1>
<p class="meta">${objectType} · ${records.length} records analysed · ${new Date().toLocaleDateString([], {year:"numeric",month:"long",day:"numeric"})}</p>
<div class="grid">${cards}</div>
<div class="footer"><span>Mondaily AI · Insights Report</span><span>${new Date().toLocaleDateString()}</span></div>
<script>window.onload=()=>window.print()<\/script></body></html>`;
    const w = window.open("","_blank"); if(w){w.document.write(html);w.document.close();}
  }

  return (
    <>
      <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] print:hidden">
        <div className="flex items-center gap-4 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[var(--section-accent-soft)] ring-1 ring-[var(--section-accent-line)]">
            <LogoMark size={16} className="text-[var(--section-accent)]"/>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">AI Insights</p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {insights ? `${insights.length} patterns from ${records.length} records` : "Surface patterns in your data with Mondaily AI"}
            </p>
          </div>
          {loading ? (
            <Loader2 size={15} className="animate-spin text-[var(--section-accent)] shrink-0"/>
          ) : error ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-faint)] max-w-[160px] truncate">{error}</span>
              <button onClick={() => { setError(null); run(); }} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Retry</button>
            </div>
          ) : insights ? (
            <div className="flex items-center gap-1.5 shrink-0">
              {insights.length > 2 && <button onClick={() => setModalOpen(true)} className="btn-secondary px-2.5 py-1.5 text-xs">Expand</button>}
              <button onClick={run} title="Regenerate" className="btn-secondary px-2.5 py-1.5 text-xs">↺</button>
            </div>
          ) : (
            <button onClick={run} className="btn-primary shrink-0 px-3.5 py-1.5 text-xs font-semibold">
              Analyse
            </button>
          )}
        </div>
        {/* Data scope BEFORE a run — the real records the agent will read (honest proof-of-work; no
            patterns implied until Analyse is pressed). Hidden once real insights exist. */}
        {!insights && !loading && !error && (
          <div className="border-t border-[var(--border-soft)] px-5 py-2.5 text-[11px] text-[var(--text-muted)]">
            Will analyse <span className="font-medium text-[var(--text-secondary)] tabular-nums">{Math.min(records.length, 50)}</span>{records.length > 50 ? ` of ${records.length}` : ""} {objectType} — real records only; no results until you run it.
          </div>
        )}
        {/* Inline insights — the top patterns live ON the page; Expand opens the full grid. */}
        {insights && insights.length > 0 && !loading && (
          <div className="border-t border-[var(--border-soft)] divide-y divide-[var(--border-soft)]">
            {insights.slice(0, 2).map((ins, i) => {
              const m = CATEGORY_META[ins.category as Cat] ?? fallbackMeta;
              return (
                <div key={i} className="px-5 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${m.dot}`}/>
                    <span className={`text-[9.5px] font-semibold uppercase tracking-widest ${m.text}`}>{m.label}</span>
                    <span className="ml-auto text-[13px] font-bold text-[var(--text-primary)]">{ins.value}</span>
                  </div>
                  <p className="text-[12px] text-[var(--text-primary)] font-medium">{ins.title}</p>
                  <p className="text-[11px] text-[var(--text-faint)] leading-relaxed mt-0.5">{ins.description}</p>
                </div>
              );
            })}
          </div>
        )}
        {insights && insights.length === 0 && !loading && (
          <div className="border-t border-[var(--border-soft)] px-5 py-3 text-[11px] text-[var(--text-faint)]">No clear patterns in this data yet — add more records and re-analyse.</div>
        )}
      </div>

      {/* Results modal */}
      {modalOpen && insights && (
        <AIModal title="AI Insights" onClose={() => setModalOpen(false)} onPrint={printInsights}>
          <div className="p-5 grid gap-3 sm:grid-cols-2">
            {insights.map((ins, i) => {
              const cat = ins.category as Cat;
              const m = CATEGORY_META[cat] ?? fallbackMeta;
              return (
                <div key={i} className={`rounded-sm border ${m.border} ${m.bg} p-4 flex flex-col gap-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${m.dot}`}/>
                      <span className={`text-body ${m.text}`}>{m.label}</span>
                    </div>
                    {ins.trend === "up"   && <TrendingUp  size={12} className="text-[#2f9e6b] shrink-0"/>}
                    {ins.trend === "down" && <TrendingDown size={12} className="text-[var(--text-secondary)] shrink-0"/>}
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--text-muted)] mb-0.5">{ins.title}</p>
                    <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{ins.value}</p>
                  </div>
                  <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">{ins.description}</p>
                  {ins.action && (
                    <div className="flex items-start gap-1.5 mt-1 pt-2 border-t border-[var(--border-soft)]">
                      <span className="text-[10px] shrink-0 text-[var(--text-secondary)] mt-0.5">→</span>
                      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">{ins.action}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 flex items-center justify-between border-t border-[var(--border-soft)]">
            <span className="text-[10px] text-[var(--text-secondary)]">Powered by Mondaily AI · {records.length} records</span>
            <button onClick={() => { setInsights(null); setModalOpen(false); run(); }} className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors">↺ Regenerate</button>
          </div>
        </AIModal>
      )}
    </>
  );
}

// ─── Digest Schedule ──────────────────────────────────────────────────────────
interface DigestConfig { id: string; object_type: string; period: string; frequency: string; recipients: string[]; label?: string; day_of_week?: number; hour: number }

const FREQ_LABELS: Record<string, string> = { daily:"Daily", weekly:"Weekly", monthly:"Monthly" };
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function DigestPanel({ objectType, objects }: { objectType: string; objects: Array<{ slug: string; name_plural: string }> }) {
  const qc = useQueryClient();
  const [open, setOpen]     = useState(false);
  const [email, setEmail]   = useState("");
  const [emails, setEmails] = useState<string[]>([]);
  const [freq, setFreq]     = useState<"daily"|"weekly"|"monthly">("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [hour, setHour]     = useState(8);
  const [period, setPeriodD] = useState<"today"|"week"|"month"|"quarter"|"year">("month");
  const [sending, setSending] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

  const digestsQ = useQuery({
    queryKey: ["digests", objectType],
    queryFn: () => apiClient.get<DigestConfig[]>("/digests"),
    select: (d) => d.filter(x => x.object_type === objectType),
  });
  const digests = digestsQ.data ?? [];

  const create = useMutation({
    mutationFn: (body: object) => apiClient.post<DigestConfig>("/digests", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["digests", objectType] }); setOpen(false); setEmails([]); setEmail(""); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/digests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["digests", objectType] }),
  });

  async function sendNow(id: string) {
    setSending(id); setSentMsg(null);
    try {
      await apiClient.post(`/digests/${id}/send`, {});
      setSentMsg("Sent!");
    } catch {
      setSentMsg("Failed — check RESEND_API_KEY");
    } finally {
      setSending(null);
      setTimeout(() => setSentMsg(null), 4000);
    }
  }

  function addEmail() {
    const v = email.trim();
    if (v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !emails.includes(v)) {
      setEmails(e => [...e, v]);
      setEmail("");
    }
  }

  const objName = objects.find(o => o.slug === objectType)?.name_plural ?? objectType;

  return (
    <div className="mb-6 print:hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2 text-xs text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Mail size={12}/> Schedule digest {digests.length > 0 && <span className="rounded-full bg-stone-500/20 text-[var(--text-secondary)] border border-stone-500/20 px-1.5 py-0.5 text-[10px]">{digests.length}</span>}
      </button>

      {open && (
        <div className="mt-3 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          <div className="px-5 py-4 border-b border-[var(--border-soft)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Scheduled email digests</h3>
            <p className="text-[11px] text-[var(--text-muted)]">Receive a KPI snapshot for <strong className="text-[var(--text-faint)]">{objName}</strong> on a schedule.</p>
          </div>

          {/* Existing digests */}
          {digests.length > 0 && (
            <div className="px-5 py-3 space-y-2 border-b border-[var(--border-soft)]">
              {digests.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5">
                  <Mail size={12} className="text-[var(--text-faint)] shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">{FREQ_LABELS[d.frequency]} · {d.period} view</p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">{d.recipients.join(", ")}</p>
                  </div>
                  {sentMsg && sending === null && d.id === digests[0]?.id && (
                    <span className="text-[10px] text-[#2f9e6b]">{sentMsg}</span>
                  )}
                  <button
                    onClick={() => sendNow(d.id)}
                    disabled={sending === d.id}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                  >
                    {sending === d.id ? <Loader2 size={11} className="animate-spin"/> : "Send now"}
                  </button>
                  <button onClick={() => remove.mutate(d.id)} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors">
                    <Trash2 size={12}/>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Create form */}
          <div className="px-5 py-4 space-y-3">
            <p className="text-body text-[var(--text-secondary)]">New schedule</p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(["daily","weekly","monthly"] as const).map(f => (
                <button key={f} onClick={() => setFreq(f)}
                  className={`rounded-sm border py-2 text-xs font-medium transition-colors ${freq===f ? "border-stone-500/30 bg-stone-600/10 text-[var(--text-secondary)]" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>
                  {FREQ_LABELS[f]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {freq === "weekly" && (
                <div>
                  <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1">Day</label>
                  <FieldSelect value={String(dayOfWeek)} onChange={v => setDayOfWeek(Number(v))} ariaLabel="Day"
                    options={DAY_NAMES.map((d, i) => ({ value: String(i), label: d }))} />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1">Hour (24h)</label>
                <FieldSelect value={String(hour)} onChange={v => setHour(Number(v))} ariaLabel="Hour (24h)"
                  options={Array.from({length:24},(_,i) => ({ value: String(i), label: `${String(i).padStart(2,"0")}:00` }))} />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1">Period view</label>
                <FieldSelect value={period} onChange={v => setPeriodD(v as typeof period)} ariaLabel="Period view"
                  options={(["today","week","month","quarter","year"] as const).map(p => ({ value: p, label: p.charAt(0).toUpperCase()+p.slice(1) }))} />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-[var(--text-secondary)] mb-1">Recipients</label>
              <div className="flex gap-1.5">
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addEmail(); } }}
                  placeholder="email@example.com"
                  className="flex-1 h-8 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-faint)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-stone-500/40"
                />
                <button aria-label="Add email recipient" onClick={addEmail} className="btn-icon h-8 w-8">
                  <Plus size={12}/>
                </button>
              </div>
              {emails.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {emails.map(e => (
                    <span key={e} className="flex items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--text-faint)]">
                      {e}
                      <button onClick={() => setEmails(arr => arr.filter(x => x !== e))} className="text-[var(--text-secondary)] hover:text-[var(--text-faint)]"><X size={9}/></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => create.mutate({ object_type: objectType, period, frequency: freq, day_of_week: freq === "weekly" ? dayOfWeek : undefined, hour, recipients: emails })}
              disabled={emails.length === 0 || create.isPending}
              className="w-full rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] py-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] disabled:opacity-40 transition-colors"
            >
              {create.isPending ? "Creating…" : "Create digest"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const PERIOD_LABELS: Record<Period,string> = { today:"Today", week:"This Week", month:"This Month", quarter:"This Quarter", year:"This Year", custom:"Custom" };

function getReportVocab(valueCol: string | null, stageCol: string | null) {
  const hasValue = !!valueCol;
  const hasStage = !!stageCol;
  return {
    kpi1Label:   hasValue ? "Total Won Value"   : "Total Records",
    trendLabel:  hasValue ? "Value Trend"       : "Activity Trend",
    tableLabel:  hasValue ? `Top by ${valueCol ?? "value"}` : "All Records",
    stageLabel:  hasStage ? `By ${stageCol}`   : "Distribution",
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function SalesReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod]             = useState<Period>("month");
  const [customStart, setCustomStart]   = useState("");
  const [customEnd, setCustomEnd]       = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen]     = useState(false);   // records-style: toggled from the toolbar Filter button
  const [goal, setGoal]                 = useState<number | null>(null);
  const [goalInput, setGoalInput]       = useState("");
  const [editingGoal, setEditingGoal]   = useState(false);
  const [drillRecord, setDrillRecord]   = useState<NodeRecord | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName]     = useState("");

  // Page-level sales report context for the right-side Ask AI drawer.
  useEffect(() => {
    useAskContextStore.getState().setContext({
      report_title: "Sales report",
      route: "/reports/sales",
      scope_label: "the Sales report",
    });
    return () => useAskContextStore.getState().setContext(null);
  }, []);

  const objectsQ = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string }>>("/objects"),
    staleTime: 60_000,
  });
  const objects = objectsQ.data ?? [];

  const urlSlug    = searchParams.get("object");
  const defaultSlug = useMemo(() => {
    if (urlSlug && objects.find(o => o.slug === urlSlug)) return urlSlug;
    return objects.find(o => ["deals","deal","sales","opportunities","pipeline"].includes(o.slug))?.slug
      ?? objects[0]?.slug ?? "deals";
  }, [objects, urlSlug]);

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const activeSlug = selectedSlug || defaultSlug;
  // Guided-empty-state destinations — real routes that put data behind this report.
  const navigate = useNavigate();
  const navigateToObjects = useCallback(() => navigate(`/objects/${activeSlug}`), [navigate, activeSlug]);
  const navigateToDiscovery = useCallback(() => navigate("/discovery"), [navigate]);

  const handleObjectChange = useCallback((slug: string) => {
    setSelectedSlug(slug);
    setSearchParams({ object: slug });
    setActiveFilters({});
    setGoal(null);
  }, [setSearchParams]);

  // ── Filter presets (localStorage per object slug) ──────────────────────────
  type FilterPreset = { id: string; name: string; filters: Record<string, string> };

  const [presets, setPresets] = useState<FilterPreset[]>([]);

  // Reload from localStorage whenever the active object changes
  useEffect(() => {
    try { setPresets(JSON.parse(localStorage.getItem(`mondaily_filter_presets_${activeSlug}`) ?? "[]")); }
    catch { setPresets([]); }
  }, [activeSlug]);

  function savePreset(name: string) {
    const key = `mondaily_filter_presets_${activeSlug}`;
    const next: FilterPreset[] = [...presets, { id: crypto.randomUUID(), name, filters: activeFilters }];
    setPresets(next);
    localStorage.setItem(key, JSON.stringify(next));
    setSavingPreset(false);
    setPresetName("");
  }

  function deletePreset(id: string) {
    const key = `mondaily_filter_presets_${activeSlug}`;
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    localStorage.setItem(key, JSON.stringify(next));
  }

  function applyPreset(preset: FilterPreset) {
    setActiveFilters(preset.filters);
  }

  const recordsQ = useQuery({
    queryKey: ["records", activeSlug],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(activeSlug)}&limit=500`),
    staleTime: 30_000,
    enabled: !!activeSlug,
  });
  const records  = recordsQ.data ?? [];

  const qc = useQueryClient();
  const annotationsQ = useQuery({
    queryKey: ["annotations", activeSlug],
    queryFn: () => apiClient.get<Array<{ id: string; source_object: string; bucket_label: string; text: string; color: string }>>(`/annotations?object_type=${encodeURIComponent(activeSlug)}`),
    staleTime: 30_000,
    enabled: !!activeSlug,
  });
  const annotations = annotationsQ.data ?? [];

  const deleteAnnotation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/annotations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["annotations", activeSlug] }),
  });

  const valueCol = useMemo(() => detectValueCol(records), [records]);
  const stageCol = useMemo(() => detectStageCol(records), [records]);
  const nameCol  = useMemo(() => detectNameCol(records),  [records]);
  const vocab    = useMemo(() => getReportVocab(valueCol, stageCol), [valueCol, stageCol]);

  // Filterable columns (2–15 unique string values, not the name/value col)
  const filterableCols = useMemo(() => {
    const allKeys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
    return allKeys.filter(k => {
      if (k === nameCol || k === valueCol) return false;
      const vals = [...new Set(records.map(r => String(r.data[k] ?? "")).filter(Boolean))];
      return vals.length >= 2 && vals.length <= 15;
    });
  }, [records, nameCol, valueCol]);

  const filteredRecords = useMemo(() =>
    records.filter(r =>
      Object.entries(activeFilters).every(([k, v]) => !v || String(r.data[k] ?? "") === v)
    ),
  [records, activeFilters]);

  const customRange = useMemo(() => {
    if (period !== "custom" || !customStart || !customEnd) return undefined;
    return { start: new Date(customStart), end: new Date(customEnd + "T23:59:59") };
  }, [period, customStart, customEnd]);

  // Currency — the report reads the workspace base + the caller's display override and the ECB
  // rates (same source as Finance Reports). Each record's value is converted from its own currency
  // (data.currency, else the base) into the display currency; the symbol below matches. Values that
  // can't convert (no rate) fall through at face value and are flagged in an honest note.
  const { base, display, currencies, rates, hasRates, ratesAsOf, setDisplay } = useCurrency();
  const curSym = CURRENCY_SYMBOL[display] ?? `${display} `;
  const toDisplay = useCallback<ValueReader>((raw, recordCurrency) => {
    const from = (recordCurrency || base).toUpperCase();
    if (from === display) return raw;
    const v = convertAmount(raw, from, display, rates);
    return v == null ? raw : v;
  }, [base, display, rates]);
  // Honest state: does the value column span more than one currency, and could everything convert?
  const valueCurrencies = useMemo(() => {
    if (!valueCol) return new Set<string>();
    return new Set(filteredRecords
      .filter(r => r.data[valueCol] != null && r.data[valueCol] !== "")
      .map(r => (String(r.data.currency ?? "") || base).toUpperCase()));
  }, [filteredRecords, valueCol, base]);
  const mixedCurrency = valueCurrencies.size > 1;
  const unconverted = useMemo(() => [...valueCurrencies].filter(c => c !== display && convertAmount(1, c, display, rates) == null).length, [valueCurrencies, display, rates]);

  const stats     = useMemo(() => computeStats(filteredRecords, valueCol, stageCol, period, customRange, toDisplay), [filteredRecords, period, valueCol, stageCol, customRange, toDisplay]);
  const prevStats = useMemo(() => {
    if (period === "custom" && customRange) {
      const dur = customRange.end.getTime() - customRange.start.getTime();
      return computeStats(filteredRecords, valueCol, stageCol, period, { start: new Date(customRange.start.getTime() - dur), end: customRange.start }, toDisplay);
    }
    const range = prevPeriodRange(period as Exclude<Period, "custom">);
    return computeStats(filteredRecords, valueCol, stageCol, period, range, toDisplay);
  }, [filteredRecords, period, valueCol, stageCol, customRange, toDisplay]);

  const stageData = useMemo(() => {
    if (!stageCol) return [];
    const counts: Record<string, { count: number; value: number }> = {};
    for (const r of filteredRecords) {
      const s = String(r.data[stageCol] ?? "Unknown");
      const rawV = valueCol ? Number(r.data[valueCol] ?? 0) : 0;
      const v = toDisplay(isNaN(rawV) ? 0 : rawV, (r.data.currency as string | undefined) ?? null);
      counts[s] = counts[s] ?? { count: 0, value: 0 };
      counts[s].count++;
      counts[s].value += isNaN(v) ? 0 : v;
    }
    return Object.entries(counts)
      .map(([label,{count,value}]) => ({ label, count, value }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredRecords, stageCol, valueCol]);

  const trendData = useMemo(() => buildTrend(filteredRecords, valueCol, stageCol, period, customRange, toDisplay), [filteredRecords, valueCol, stageCol, period, customRange, toDisplay]);
  // Honest value-chart gate: a value column exists but every bucket is zero → show an inline empty
  // state instead of a dead flat line (never pretend there's a value signal when there isn't one).
  const hasValueData = useMemo(() => trendData.some(d => (d.revenue ?? 0) > 0), [trendData]);

  // ── Phase 3e — server-backed KPIs (Total Records always; Total Value for stage-less objects) ──
  // These escape the client 500-row cap by aggregating the WHOLE table on the server, scoped to the
  // SAME period (date_filter on updated_at) + the SAME equality filters the client applies. Only
  // count/sum switch — semantics identical; the stage-derived KPIs (won/open/completion) stay client
  // because the generic endpoint deliberately doesn't classify won/lost. Server value is preferred
  // when present; on load/error it falls back to the client stat (never a blank, never a fake number).
  const dateFilter = useMemo<AggDateFilter>(() => {
    const start = customRange ? customRange.start : periodStart(period);
    const end   = customRange ? customRange.end   : new Date();
    return { field: "updated_at", from: start.toISOString(), to: end.toISOString() };
  }, [period, customRange]);
  const aggFilters = useMemo<AggFilter[]>(
    () => Object.entries(activeFilters).filter(([, v]) => !!v).map(([column, value]) => ({ column, value })),
    [activeFilters]);
  const serverCount = useRecordAggregate({ objectType: activeSlug, column: "name", op: "count", dateFilter, filters: aggFilters, enabled: !!activeSlug });
  const serverValue = useRecordAggregate({ objectType: activeSlug, column: valueCol ?? "", op: "sum", currency: true, dateFilter, filters: aggFilters, enabled: !!activeSlug && !!valueCol && !stageCol });
  const kTotalCount = serverCount.data?.value ?? stats.totalCount;   // server full-table count, else client
  const kTotalValue = serverValue.data?.value ?? stats.totalValue;   // server full-table sum (stage-less), else client

  // ── Phase 3f — stage-derived KPIs from ONE grouped aggregate on the stage column ──
  // Backend only groups by the raw stage column (already supported); we classify the returned labels
  // client-side with the same isWon/isLost/isOpen. Currency-aware (op:sum when there's a value column),
  // same date + equality scope, capped/truncation-honest. Falls back to the client 500-row stats.
  const serverStage = useRecordAggregate({
    objectType: activeSlug, column: valueCol ?? "name", op: valueCol ? "sum" : "count",
    groupBy: stageCol ?? "none", currency: !!valueCol, dateFilter, filters: aggFilters,
    enabled: !!activeSlug && !!stageCol,
  });
  const sStage = useMemo(() => {
    const groups = serverStage.data?.groups;
    return groups ? deriveStageStats(groups as StageGroup[], !!valueCol) : null;
  }, [serverStage.data, valueCol]);
  const kWonValue   = sStage?.wonValue ?? stats.wonValue;
  const kCompletion = sStage?.completionRate ?? stats.completionRate;
  const kOpenValue  = sStage?.openValue ?? stats.openValue;
  const kOpenCount  = sStage?.openCount ?? stats.openCount;
  const kAvg        = sStage?.avgVal ?? stats.avgVal;
  const serverBacked = !!serverCount.data || !!sStage;
  const serverUnconverted = (serverValue.data?.unconverted ?? 0) + (serverStage.data?.unconverted ?? 0);


  const topRecords = useMemo(() => {
    if (!valueCol) return filteredRecords.slice(0, 10);
    return [...filteredRecords]
      .filter(r => r.data[valueCol] != null)
      .sort((a,b) => Number(b.data[valueCol] ?? 0) - Number(a.data[valueCol] ?? 0))
      .slice(0, 10);
  }, [filteredRecords, valueCol]);

  // ── Phase 3h — server-backed Top Records ──
  // Ranks the WHOLE (date + filter-scoped, capped) table by the value column on the server, escaping
  // the client 500-row page. Only meaningful when there's a value column; otherwise the client first-10
  // is kept. Semantically identical to the client sort (rank all rows by value, no stage semantics on the
  // backend). Falls back to the client topRecords on load/error, so behaviour never blanks.
  const serverTop = useRecordAggregate({
    objectType: activeSlug, column: valueCol ?? "name", op: "top", limit: 10,
    currency: !!valueCol, dateFilter, filters: aggFilters,
    enabled: !!activeSlug && !!valueCol,
  });
  // Loaded-page lookup so a server-ranked row can be enriched (stage badge + drill) when it's on the
  // current page; rows beyond the page render name+value only (honest, no fabricated stage/drill).
  const recById = useMemo(() => {
    const m = new Map<string, NodeRecord>();
    for (const r of records) m.set(r.id, r);
    return m;
  }, [records]);
  const topValOf = (r: NodeRecord) => { const n = Number(r.data[valueCol!] ?? 0); return toDisplay(isNaN(n) ? 0 : n, (r.data.currency as string | undefined) ?? null); };
  // Normalised rows the visible table AND the print/export both consume (single source → they can't drift).
  // Uses valueCol/stageCol directly (hasValue/hasStage are declared further down).
  const topRows = useMemo(() => {
    const srv = serverTop.data?.rows;
    if (valueCol && srv?.length) {
      return srv.map((row) => {
        const rec = row.id ? recById.get(row.id) ?? null : null;
        return {
          id: row.id ?? rec?.id ?? row.label,
          name: rec ? String(rec.data[nameCol] ?? row.label) : row.label,
          stage: stageCol && rec ? String(rec.data[stageCol] ?? "—") : "",
          val: row.value,
          record: rec,
        };
      });
    }
    return topRecords.map((r) => ({
      id: r.id,
      name: String(r.data[nameCol] ?? "—"),
      stage: stageCol ? String(r.data[stageCol] ?? "—") : "",
      val: valueCol ? topValOf(r) : 0,
      record: r as NodeRecord | null,
    }));
  }, [serverTop.data, topRecords, recById, nameCol, stageCol, valueCol, toDisplay]);
  const topServer = !!valueCol && !!serverTop.data?.rows?.length;
  const topTruncated = topServer && !!serverTop.data?.truncated;
  const topUnconverted = topServer ? (serverTop.data?.unconverted ?? 0) : 0;

  function generateReport() {
    const periodLabel = period === "custom" && customStart && customEnd
      ? `${customStart} – ${customEnd}`
      : PERIOD_LABELS[period];
    // Print/export ranks from the SAME normalised topRows the visible table uses (server-backed when
    // available, else the client page) — so the printed table can never drift from the screen.
    const totalValue = hasValue ? topRows.reduce((s, r) => s + r.val, 0) : 0;
    const maxVal = hasValue ? Math.max(...topRows.map(r => r.val), 1) : 1;

    const rows = topRows.map((r, i) => {
      const name  = r.name;
      const stage = hasStage ? (r.stage || "—") : "";
      const val   = hasValue ? r.val : 0;
      const pct   = hasValue && !isNaN(val) ? Math.round((val / maxVal) * 100) : 0;
      return `
        <tr>
          <td class="rank">${i + 1}</td>
          <td class="name">${name}</td>
          ${hasStage ? `<td class="stage">${stage}</td>` : ""}
          ${hasValue ? `<td class="value">${fmtMoney(isNaN(val) ? 0 : val, curSym)}</td>` : ""}
          ${hasValue ? `<td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td>` : ""}
        </tr>`;
    }).join("");

    const trendRows = trendData.map(d => `
      <tr>
        <td>${d.label}</td>
        ${hasValue ? `<td class="num">${fmtMoney(d.revenue, curSym)}</td>` : ""}
        <td class="num">${d.count}</td>
      </tr>`).join("");

    // Print/export KPIs read the SAME server-preferred source (k*) as the visible cards, so a printed
    // report never diverges from what's on screen. The k* consts are declared above this function
    // (server value when the grouped/total aggregate is loaded, else the client stat) — no TDZ.
    const kpis = [
      { label: hasValue ? (hasStage ? "Won Value" : "Total Value") : "Total Records", value: hasValue ? fmtMoney(hasStage ? (kWonValue || (sStage?.totalValue ?? stats.totalValue)) : kTotalValue, curSym) : fmtNum(kTotalCount) },
      { label: hasStage ? "In Progress" : "This Period", value: hasValue ? fmtMoney(kOpenValue, curSym) : fmtNum(kOpenCount || kTotalCount) },
      { label: hasStage ? "Completion Rate" : "Total Records", value: hasStage ? `${kCompletion}%` : fmtNum(kTotalCount) },
      { label: hasValue ? `Avg ${valueCol}` : "Avg / Bucket", value: hasValue ? fmtMoney(kAvg, curSym) : fmtNum(stats.totalCount ? Math.round(stats.totalCount / Math.max(trendData.length, 1)) : 0) },
    ];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${objLabel} Report — ${periodLabel}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a2e; background: #fff; font-size: 12px; }
    .page { max-width: 900px; margin: 0 auto; padding: 48px 48px 64px; }
    /* Header */
    .header { display: flex; align-items: flex-start; justify-content: space-between; padding-bottom: 20px; border-bottom: 2px solid #e5e7eb; margin-bottom: 28px; }
    .header-brand { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; }
    .header-title { font-size: 22px; font-weight: 700; color: #111; margin-top: 4px; }
    .header-meta { font-size: 11px; color: #9ca3af; margin-top: 3px; }
    .header-right { text-align: right; }
    .header-period { font-size: 13px; font-weight: 600; color: #374151; }
    /* KPI grid */
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px; }
    .kpi { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #9ca3af; margin-bottom: 4px; }
    .kpi-value { font-size: 20px; font-weight: 700; color: #111; }
    /* Table */
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #6b7280; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    th { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: #9ca3af; text-align: left; padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
    td { padding: 9px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .rank { font-size: 11px; font-weight: 700; color: #d1d5db; width: 28px; }
    tr:nth-child(1) .rank { color: #c6892e; }
    tr:nth-child(2) .rank { color: #9ca3af; }
    tr:nth-child(3) .rank { color: #cd7c43; }
    .name { font-weight: 600; color: #111; }
    .stage { font-size: 11px; color: #6b7280; }
    .value { font-weight: 700; color: #111; text-align: right; font-variant-numeric: tabular-nums; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bar-cell { width: 100px; }
    .bar-track { height: 5px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, var(--section-accent), var(--section-accent)); border-radius: 99px; }
    .tfoot td { font-weight: 700; font-size: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; border-bottom: none; }
    /* Trend table */
    .trend-table th, .trend-table td { padding: 7px 10px; }
    /* Footer */
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 10px; color: #9ca3af; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 24px 32px 40px; }
    }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="header-brand">Mondaily</div>
      <div class="header-title">${objLabel} Report</div>
      <div class="header-meta">Generated ${now} · ${filteredRecords.length} records</div>
    </div>
    <div class="header-right">
      <div class="header-period">${periodLabel}</div>
    </div>
  </div>

  <div class="kpi-grid">
    ${kpis.map(k => `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join("")}
  </div>

  <div class="section-title">Top ${objLabel}</div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Name</th>
        ${hasStage ? `<th>${stageCol}</th>` : ""}
        ${hasValue ? `<th style="text-align:right">${valueCol}</th>` : ""}
        ${hasValue ? `<th></th>` : ""}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    ${hasValue ? `<tfoot><tr><td colspan="${1 + (hasStage ? 1 : 0) + 1}" class="tfoot">Total</td><td class="tfoot value">${fmtMoney(totalValue, curSym)}</td><td></td></tr></tfoot>` : ""}
  </table>

  ${trendData.length > 0 ? `
  <div class="section-title">Trend — ${periodLabel}</div>
  <table class="trend-table">
    <thead><tr><th>Period</th>${hasValue ? `<th style="text-align:right">${valueCol}</th>` : ""}<th style="text-align:right">Records</th></tr></thead>
    <tbody>${trendRows}</tbody>
  </table>` : ""}

  <div class="footer">
    <span>Mondaily · ${objLabel} Report</span>
    <span>${now}</span>
  </div>
</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  }

  const selectedObj = objects.find(o => o.slug === activeSlug);
  const objLabel    = selectedObj?.name_plural ?? activeSlug;
  const now         = new Date().toLocaleDateString([], { year:"numeric", month:"long", day:"numeric" });
  const hasValue    = !!valueCol;
  const hasStage    = !!stageCol;
  const hasFilters  = filterableCols.length > 0;
  const filtersActive = Object.values(activeFilters).some(Boolean);

  function exportCSV() {
    const cols = [nameCol, stageCol, valueCol, ...filterableCols.filter(c => c !== stageCol)].filter((c): c is string => !!c);
    const header = cols.join(",");
    const rows   = filteredRecords.map(r =>
      cols.map(c => `"${String(r.data[c] ?? "").replace(/"/g, '""')}"`).join(",")
    );
    const csv  = [header, ...rows].join("\n");
    const url  = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a    = Object.assign(document.createElement("a"), { href: url, download: `${activeSlug}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  function saveGoal() {
    const n = parseFloat(goalInput.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n > 0) setGoal(n);
    setEditingGoal(false);
    setGoalInput("");
  }

  return (
    <div className="min-h-full bg-[var(--surface-card)] print:bg-white text-[var(--text-primary)] print:text-black">
      {/* Print header */}
      <div className="hidden print:flex items-center justify-between px-8 py-6 border-b border-[var(--border-soft)]">
        <div>
          <h1 className="text-2xl font-bold text-black">Live Report — {objLabel}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{PERIOD_LABELS[period]} · Generated {now}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-black">Mondaily</p>
          <p className="text-xs text-[var(--text-muted)]">Business Intelligence</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 print:max-w-none print:px-8">
        {/* Screen header — TWO calm rows, not one wall of ten controls.
            Row 1 is identity (where am I, what am I looking at, how honest is the data);
            row 2 is control (lens on the left, actions on the right). Every control and
            handler from the old single row survives verbatim — this restructure is layout
            only, which is what makes it safe on a money surface that broke once before. */}
        <div className="mb-1.5 flex items-center gap-3 print:hidden">
          <Link to="/reports" className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0">
            <ArrowLeft size={12}/> Reports
          </Link>
          <span className="text-[var(--text-secondary)] text-xs shrink-0">/</span>
          <h1 className="text-sm font-semibold text-[var(--text-primary)] shrink-0">Live Report</h1>
          {objects.length > 0 && <ObjectPicker objects={objects} value={activeSlug} onChange={handleObjectChange}/>}
          <span className="ml-auto text-xs text-[var(--text-secondary)] hidden sm:inline" title="Data scope — computed live from your real records">
            {records.length} records analysed{filteredRecords.length !== records.length && ` · ${filteredRecords.length} in filter`}
            {hasValue && mixedCurrency && <> · <span title={hasRates ? `Converted to ${display} at ECB rate${ratesAsOf ? `, ${new Date(ratesAsOf).toLocaleDateString()}` : ""}` : "No FX rates loaded — mixed-currency values shown at face value"} style={{ color: unconverted > 0 || !hasRates ? "var(--status-warn)" : "var(--text-muted)" }}>{!hasRates ? `mixed currencies · at face value` : unconverted > 0 ? `${unconverted} currency${unconverted === 1 ? "" : "ies"} not converted` : `converted to ${display}`}</span></>}
          </span>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden">
          {/* The lens: period + display currency. The period row is the SegmentedControl's third
              adopter — this was the last hand-rolled copy of the pill pattern. */}
          <SegmentedControl
            segments={(["today","week","month","quarter","year","custom"] as Period[]).map(p => ({ key: p, label: PERIOD_LABELS[p] }))}
            active={period}
            onChange={(k) => setPeriod(k as Period)}
          />
          {hasValue && (
            <div className="flex items-center gap-1.5">
              <span className="hidden text-[11px] text-[var(--text-muted)] sm:inline">Show in</span>
              <div className="w-[74px]">
                <FieldSelect value={display} onChange={v => setDisplay.mutate(v)} ariaLabel="Display currency"
                  options={currencyOptions(currencies)} />
              </div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {hasFilters && (
              <FilterButton open={filterOpen} onToggle={() => setFilterOpen(o => !o)} activeCount={Object.values(activeFilters).filter(Boolean).length} />
            )}
            <button onClick={exportCSV}
              className="flex items-center gap-1 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
              <Download size={12}/> CSV
            </button>
            <button onClick={generateReport}
              className="flex items-center gap-1 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-2.5 py-1 text-xs text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors">
              <Printer size={12}/> Export
            </button>
          </div>
        </div>

        {/* Custom date range row — only shown when Custom period is active */}
        {period === "custom" && (
          <div className="mb-4 flex items-center gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 print:hidden">
            <span className="text-[11px] font-medium text-[var(--text-muted)] shrink-0">Date range</span>
            <div className="flex items-center gap-2 ml-2">
              <DateField value={customStart} onChange={setCustomStart} ariaLabel="From date" placeholder="From" className="!h-7 !text-xs"/>
              <span className="text-xs text-[var(--text-secondary)]">→</span>
              <DateField value={customEnd} onChange={setCustomEnd} ariaLabel="To date" placeholder="To" className="!h-7 !text-xs"/>
            </div>
            {customStart && customEnd && (
              <span className="ml-auto text-[11px] text-[var(--text-secondary)]">
                {new Date(customStart).toLocaleDateString(undefined,{month:"short",day:"numeric"})} – {new Date(customEnd).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}
              </span>
            )}
          </div>
        )}

        {/* Digest scheduler */}
        <DigestPanel objectType={activeSlug} objects={objects}/>

        {/* Filter presets row */}
        {(hasFilters && filterOpen && (presets.length > 0 || filtersActive)) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 print:hidden">
            <Bookmark size={11} className="text-[var(--text-secondary)] shrink-0"/>
            <span className="text-[10px] font-medium text-[var(--text-secondary)] mr-0.5">Presets</span>
            {presets.map(p => {
              const active = JSON.stringify(activeFilters) === JSON.stringify(p.filters);
              return (
                <span key={p.id} className={`group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-pointer transition-colors ${active ? "border-[#717784]/40 bg-[#717784]/10 text-[#717784]" : "border-[var(--border-soft)] bg-[var(--surface-hover)] text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:border-[var(--border-soft)]"}`}
                  onClick={() => applyPreset(p)}>
                  {p.name}
                  <button onClick={e => { e.stopPropagation(); deletePreset(p.id); }}
                    className="opacity-0 group-hover:opacity-100 ml-0.5 text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-all">
                    <X size={9}/>
                  </button>
                </span>
              );
            })}
            {filtersActive && !savingPreset && (
              <button onClick={() => setSavingPreset(true)}
                className="flex items-center gap-1 rounded-full border border-dashed border-[var(--border-soft)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-soft)] transition-colors">
                <Plus size={9}/> Save current
              </button>
            )}
            {savingPreset && (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && presetName.trim()) savePreset(presetName.trim()); if (e.key === "Escape") { setSavingPreset(false); setPresetName(""); } }}
                  placeholder="Preset name…"
                  className="h-6 rounded-md border border-[#717784]/25 bg-[var(--surface-card)] px-2 text-[11px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[#717784]/50 w-36"
                />
                <button onClick={() => { if (presetName.trim()) savePreset(presetName.trim()); }}
                  disabled={!presetName.trim()}
                  className="h-6 rounded-sm border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-2 text-[10px] text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)] hover:border-[var(--section-accent)] disabled:opacity-40">
                  Save
                </button>
                <button onClick={() => { setSavingPreset(false); setPresetName(""); }} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"><X size={11}/></button>
              </div>
            )}
          </div>
        )}

        {/* Filter bar — records-style: revealed only when the toolbar Filter button is toggled on */}
        {hasFilters && filterOpen && (
          <div className={`mb-4 print:hidden rounded-sm border transition-colors ${filtersActive ? "border-[#717784]/25 bg-[#717784]/[.03]" : "border-[var(--border-soft)] bg-[var(--surface-hover)]"}`}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-soft)]">
              <Filter size={11} className="text-[var(--text-muted)] shrink-0"/>
              <span className="text-[11px] font-medium text-[var(--text-muted)]">Filters</span>
              {filtersActive ? (
                <>
                  <span className="rounded-full bg-[#717784]/20 text-[#717784] text-[10px] font-bold px-1.5 py-0.5 ml-0.5">
                    {Object.values(activeFilters).filter(Boolean).length}
                  </span>
                  <button onClick={() => setActiveFilters({})} className="ml-auto text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-colors">
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-[var(--text-secondary)] ml-1">— select to narrow results</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-2.5 p-3">
              {filterableCols.map(col => {
                const uniqueVals = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort();
                const active = !!activeFilters[col];
                return (
                  <div key={col} className="flex flex-col gap-1 min-w-0">
                    <label className="text-body text-[var(--text-secondary)] truncate">{col.replace(/_/g," ")}</label>
                    <FieldSelect
                      value={activeFilters[col] ?? ""}
                      onChange={v => setActiveFilters(f => ({ ...f, [col]: v }))}
                      ariaLabel={col.replace(/_/g," ")}
                      className={active ? "border-[#717784]/40 bg-[#717784]/10 text-[#717784]" : ""}
                      options={[{ value: "", label: "All" }, ...uniqueVals.map(v => ({ value: v, label: v }))]}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Print period */}
        <div className="hidden print:block mb-6">
          <p className="text-sm font-semibold text-[var(--text-secondary)]">{objLabel} — {period === "custom" && customStart && customEnd ? `${customStart} – ${customEnd}` : PERIOD_LABELS[period]}</p>
        </div>

        {recordsQ.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-500/30 border-t-[#d1524a]"/>
          </div>
        ) : records.length === 0 ? (
          // Guided empty report — real ways to get data in. The report recomputes live the moment
          // records exist; nothing here shows placeholder numbers.
          <EmptyState
            icon={BarChart2}
            title={`No ${objLabel} records yet`}
            description={`This report computes live from your ${objLabel.toLowerCase()} — KPIs, trends, and AI insights appear the moment records exist.${objects.length > 1 ? " You can also pick a different object type above." : ""}`}
            steps={[
              { icon: Database, label: `Add your first ${objLabel.toLowerCase()}`, hint: "Create records directly in the sheet — the report updates instantly.", onClick: () => navigateToObjects() },
              { icon: UploadCloud, label: "Import a CSV", hint: "Bring existing data across — the importer maps your columns.", onClick: () => navigateToObjects() },
              { icon: Radar, label: "Find leads with Discovery", hint: "Search the web for source-backed leads and save them into your graph.", onClick: () => navigateToDiscovery() },
            ]}
          />
        ) : (
          <>
            {/* Goal dialog */}
            {editingGoal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="w-72 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] p-5">
                  <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Set a goal for {vocab.kpi1Label}</h3>
                  <input
                    autoFocus
                    value={goalInput}
                    onChange={e => setGoalInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveGoal(); if (e.key === "Escape") setEditingGoal(false); }}
                    placeholder={hasValue ? "e.g. 100000" : "e.g. 500"}
                    className="key-input w-full mb-3"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveGoal} className="btn-primary flex-1 py-2 text-xs font-medium">Set goal</button>
                    <button onClick={() => setEditingGoal(false)} className="btn-secondary px-3 py-2 text-xs">Cancel</button>
                    {goal && <button onClick={() => { setGoal(null); setEditingGoal(false); }} className="btn-secondary px-3 py-2 text-xs">Clear</button>}
                  </div>
                </div>
              </div>
            )}

            {/* Executive KPI strip — PRIMARY headline metrics (large), then a compact SECONDARY row.
                Cohesive neutral cards with toned left-accents (no candy backgrounds). Values unchanged. */}
            <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
              <KpiCard sym={curSym} primary
                label={hasValue ? (hasStage ? "Won Value" : "Total Value") : "Total Records"}
                value={hasValue ? fmtMoney(hasStage ? (kWonValue || (sStage?.totalValue ?? stats.totalValue)) : kTotalValue, curSym) : fmtNum(kTotalCount)}
                sub={hasStage ? `${sStage?.wonCount ?? stats.wonCount} completed` : `${kTotalCount} total`}
                tone="#2f9e6b"
                trend="up"
                delta={pctDelta(hasValue ? (stats.wonValue || stats.totalValue) : stats.totalCount, hasValue ? (prevStats.wonValue || prevStats.totalValue) : prevStats.totalCount)}
                goal={goal}
                goalValue={hasValue ? (hasStage ? (kWonValue || (sStage?.totalValue ?? stats.totalValue)) : kTotalValue) : kTotalCount}
                onSetGoal={() => setEditingGoal(true)}
              />
              <KpiCard sym={curSym} primary
                label={hasStage ? "Completion Rate" : "Total This Period"}
                value={hasStage ? `${kCompletion}%` : fmtNum(kTotalCount)}
                sub={hasStage ? "closed won vs. all closed" : `across ${PERIOD_LABELS[period].toLowerCase()}`}
                tone="var(--section-accent)"
                trend={hasStage ? (kCompletion >= 50 ? "up" : "down") : "neutral"}
                delta={pctDelta(stats.completionRate, prevStats.completionRate)}
              />
              <KpiCard sym={curSym} primary
                label="Total Records"
                value={fmtNum(kTotalCount)}
                sub="in this period"
                tone="#8a8f9a"
                delta={pctDelta(stats.totalCount, prevStats.totalCount)}
              />
            </div>
            {/* Honest provenance for the switched KPIs — server totals over the WHOLE table (period +
                filters scoped), truncated/unconverted flagged; a plain client-500 note otherwise. */}
            {serverBacked && (() => {
              // Prefer the count scope for the row-window note; fall back to the stage-grouped scope.
              const scope = serverCount.data ?? serverStage.data;
              return (
                <p className="mb-4 -mt-1 text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {hasStage ? "KPIs" : `Total records${hasValue ? " & value" : ""}`} · server total
                  {scope && (scope.truncated ? <span style={{ color: "#c6892e" }}> · first {scope.total_rows.toLocaleString()}</span> : <> · over {scope.total_rows.toLocaleString()}</>)}
                  {serverUnconverted > 0 && <span style={{ color: "#c6892e" }}> · {serverUnconverted} unconverted</span>}
                  {/* The ± badges are period-over-period from the recent sample, not the server total. */}
                  <span title="Period-over-period change is computed from the recent record sample, not the full-table server total."> · Δ vs. previous period (recent sample)</span>
                </p>
              );
            })()}
            <div className="mb-6 grid gap-3 grid-cols-3 print:grid-cols-3 print:gap-3">
              <KpiCard sym={curSym}
                label={hasStage ? "In Progress" : "This Period"}
                value={hasValue ? fmtMoney(kOpenValue, curSym) : fmtNum(kOpenCount || kTotalCount)}
                sub={hasStage ? `${kOpenCount} open` : "active records"}
                tone="#717784"
                trend="neutral"
                delta={pctDelta(hasValue ? stats.openValue : stats.openCount, hasValue ? prevStats.openValue : prevStats.openCount)}
              />
              <KpiCard sym={curSym}
                label={hasValue ? `Avg ${valueCol}` : "Avg per bucket"}
                value={hasValue ? fmtMoney(kAvg, curSym) : fmtNum(stats.totalCount ? Math.round(stats.totalCount / Math.max(trendData.length, 1)) : 0)}
                sub="per record"
                tone="#c6892e"
                delta={pctDelta(stats.avgVal, prevStats.avgVal)}
              />
              <KpiCard sym={curSym}
                label={hasStage ? "Open / Active" : "All Time"}
                value={fmtNum(hasStage ? kOpenCount : records.length)}
                sub={hasStage ? "in pipeline" : "records total"}
                tone="var(--section-accent)"
              />
            </div>

            {/* AI Panels — side by side */}
            <div className="mb-6 grid gap-4 lg:grid-cols-2 print:hidden">
              <AIForecastCard sym={curSym}
                objectType={activeSlug}
                valueCol={valueCol}
                stageCol={stageCol}
                period={period}
                stats={stats}
                prevStats={prevStats}
                trendData={trendData}
              />
              <AIInsightsPanel records={filteredRecords} objectType={activeSlug}/>
            </div>

            {/* Charts */}
            <div className="mb-6 grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-4">
              <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-5 print:border-[var(--border-soft)] print:bg-white">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold print:text-black">{vocab.trendLabel}</h3>
                  <span className="text-[10px] text-[var(--text-secondary)] print:hidden">Clean trend</span>
                </div>
                {trendData.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-1 text-center"><span className="text-xs" style={{ color: "var(--text-muted)" }}>No records in this period</span><span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Widen the date range above, or add records — the trend draws itself from real data.</span></div>
                ) : (hasValue && !hasValueData) ? (
                  <NoValueData col={valueCol} />
                ) : (
                  <div className="relative">
                    <Sparkline values={trendData.map(item => hasValue ? item.revenue : item.count)} />
                  </div>
                )}

                {/* Annotation list */}
                {annotations.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 print:hidden">
                    {annotations.map(a => (
                      <span key={a.id} className="group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
                        style={{ borderColor: a.color + "40", color: a.color, background: a.color + "10" }}>
                        <span style={{ color: a.color }}>◆</span>
                        <span className="text-[var(--text-faint)]">{a.bucket_label}:</span>
                        {a.text}
                        <button onClick={() => deleteAnnotation.mutate(a.id)} className="ml-0.5 opacity-0 group-hover:opacity-100 text-[var(--text-secondary)] hover:text-[var(--text-faint)] transition-all">
                          <X size={9}/>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-5 print:border-[var(--border-soft)] print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">{vocab.stageLabel}</h3>
                {stageData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-[var(--text-secondary)]">
                    {hasStage ? "No stage data" : `No "${stageCol ?? "status"}" column detected`}
                  </div>
                ) : (
                  <Sparkline values={stageData.map(item => item.count)} />
                )}
              </div>

              <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-5 print:border-[var(--border-soft)] print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Activity Over Time</h3>
                {trendData.length === 0 ? (
                  <div className="flex h-48 flex-col items-center justify-center gap-1 text-center"><span className="text-xs" style={{ color: "var(--text-muted)" }}>No records in this period</span><span className="text-[11px]" style={{ color: "var(--text-faint)" }}>Widen the date range above, or add records — the trend draws itself from real data.</span></div>
                ) : (
                  <Sparkline values={trendData.map(item => item.count)} />
                )}
              </div>

              {hasValue && hasStage && (
                <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-5 print:border-[var(--border-soft)] print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">Value by {stageCol}</h3>
                  {stageData.some(item => (item.value ?? 0) > 0) ? (
                    <Sparkline values={stageData.map(item => item.value)} />
                  ) : (
                    <NoValueData col={valueCol} />
                  )}
                </div>
              )}

              {hasValue && !hasStage && (
                <div className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] p-5 print:border-[var(--border-soft)] print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">{valueCol} Distribution</h3>
                  {hasValueData ? (
                    <Sparkline values={trendData.map(item => item.revenue)} />
                  ) : (
                    <NoValueData col={valueCol} />
                  )}
                </div>
              )}
            </div>

            {/* Top Records List */}
            {(() => {
              // Ranked from the shared topRows (server-backed full-table ranking when available, else the
              // client page). Values are already in the display currency.
              const maxVal = hasValue ? Math.max(...topRows.map(r => r.val), 1) : 1;
              const total = hasValue ? topRows.reduce((s, r) => s + r.val, 0) : 0;
              // One accent for every row. The previous 10-colour rotating palette encoded RANK
              // POSITION in hue — information already carried by the ordering and the bar length —
              // and reused the green/amber/red STATUS tokens for it, so a top-5 list looked like
              // five different health states.
              const ROW_ACCENT = { badge: "bg-[var(--section-accent)]/12 text-[var(--section-accent-text)] border-[var(--section-accent-line)]" };
              return (
                <div className="mb-6 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] overflow-hidden print:border-[var(--border-soft)] print:bg-white">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-soft)]">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] print:text-black">{vocab.tableLabel}</h3>
                    {hasValue && (
                      <span className="text-xs text-[var(--text-muted)]">
                        Total <span className="font-semibold text-[var(--text-faint)] ml-1">{fmtMoney(total, curSym)}</span>
                      </span>
                    )}
                  </div>
                  {/* Column labels */}
                  <div className="grid px-5 py-2 border-b border-[var(--border-soft)]" style={{ gridTemplateColumns: hasValue ? "2rem 1fr auto auto" : "2rem 1fr auto" }}>
                    <span/>
                    <span className="text-body text-[var(--text-secondary)]">Name</span>
                    {hasStage && <span className="text-body text-[var(--text-secondary)] mr-4">{stageCol?.replace(/_/g," ")}</span>}
                    {hasValue && <span className="text-body text-[var(--text-secondary)] text-right">{valueCol?.replace(/_/g," ")}</span>}
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-white/[.03]">
                    {topRows.map((row, i) => {
                      const r       = row.record;
                      const stage   = hasStage ? (row.stage || "—") : "";
                      const val     = hasValue ? row.val : 0;
                      const pct     = hasValue && !isNaN(val) ? Math.max(4, Math.round((val / maxVal) * 100)) : 0;
                      const won     = hasStage && isWon(stage);
                      const lost    = hasStage && isLost(stage);
                      const color   = ROW_ACCENT;
                      const rankColors = ["text-[#c6892e]","text-[var(--text-secondary)]","text-[#8a8071]"];
                      const drillable = !!r;
                      return (
                        <div
                          key={row.id}
                          onClick={drillable ? () => setDrillRecord(r!) : undefined}
                          className={`group relative px-5 py-3 transition-colors ${drillable ? "cursor-pointer hover:bg-[var(--surface-hover)]" : ""}`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Rank */}
                            <span className={`w-7 shrink-0 text-center text-xs font-bold tabular-nums ${i < 3 ? rankColors[i] : "text-[var(--text-secondary)]"}`}>
                              {i + 1}
                            </span>
                            {/* Name + bar */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm font-medium text-[var(--text-primary)] truncate print:text-black">
                                  {row.name}
                                </span>
                                {hasValue && (
                                  <span className="ml-4 shrink-0 font-mono text-sm font-semibold text-[var(--text-primary)] print:text-black">
                                    {fmtMoney(isNaN(val) ? 0 : val, curSym)}
                                  </span>
                                )}
                              </div>
                              {hasValue && (
                                <div className="h-1.5 w-full rounded-full bg-[var(--surface-hover)] overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, background: "var(--section-accent)" }}
                                  />
                                </div>
                              )}
                            </div>
                            {/* Stage badge — only when we have the record on the current page (off-page
                                server-ranked rows carry no stage, so we don't fabricate one). */}
                            {hasStage && stage && (
                              <span className={`ml-3 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${won ? "bg-[#2f9e6b]/10 text-[#2f9e6b] border-[#2f9e6b]/25" : lost ? "bg-stone-500/10 text-[var(--text-secondary)] border-stone-500/20" : color.badge} print:bg-transparent print:text-[var(--text-secondary)] print:border-[var(--border-soft)]`}>
                                {stage}
                              </span>
                            )}
                            {drillable && <ChevronRight size={12} className="shrink-0 text-[var(--text-secondary)] group-hover:text-[var(--text-faint)] transition-colors print:hidden"/>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Footer total */}
                  {hasValue && (
                    <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-5 py-3 print:border-[var(--border-soft)]">
                      <span className="text-xs text-[var(--text-muted)]">
                        Top {topRows.length} records
                        {topServer
                          ? (topTruncated
                              ? <span className="text-[#c6892e]" title="Ranked within the first 10,000 records (the full table exceeds the aggregation cap)."> · ranked within first {serverTop.data!.total_rows.toLocaleString()}</span>
                              : <span title="Ranked across the full table on the server."> · across {serverTop.data!.total_rows.toLocaleString()}</span>)
                          : <span title="Ranked from the recent record sample, not the full table."> · recent sample</span>}
                        {topUnconverted > 0 && <span className="text-[#c6892e]" title="Some records used their face value because a currency rate was missing."> · {topUnconverted} unconverted</span>}
                      </span>
                      <span className="font-mono text-sm font-bold text-[var(--text-primary)] print:text-black">{fmtMoney(total, curSym)}</span>
                    </div>
                  )}
                </div>
              );
            })()}

          </>
        )}
      </div>

      {/* Print footer */}
      <div className="hidden print:flex mt-8 px-8 pb-6 border-t border-[var(--border-soft)] pt-4 text-xs text-[var(--text-faint)] justify-between">
        <span>Mondaily — Live Report ({objLabel})</span>
        <span>{now}</span>
      </div>

      {/* Drill-down panel */}
      {drillRecord && (
        <DrillPanel record={drillRecord} nameCol={nameCol} onClose={() => setDrillRecord(null)}/>
      )}
    </div>
  );
}
