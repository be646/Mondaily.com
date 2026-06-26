import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Printer, TrendingUp, TrendingDown, Minus, ArrowLeft, ChevronDown,
  Download, Target, Sparkles, X, ChevronRight, Filter, Loader2, AlertCircle, Mail, Plus, Trash2, Bookmark,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../../lib/api-client";
import { useAskContextStore } from "../../../lib/ask-context-store";

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
function isWon(stage: string)  { return WON_KEYWORDS.some(k  => stage.toLowerCase().includes(k)); }
function isLost(stage: string) { return LOST_KEYWORDS.some(k => stage.toLowerCase().includes(k)); }
function isOpen(stage: string) { return !isWon(stage) && !isLost(stage); }

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
function fmtNum(n: number) { return n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n); }

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
    <div className="rounded-xl bg-white p-5 print:bg-white dark:bg-stone-950/40" style={{ height }}>
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

function buildTrend(records: NodeRecord[], valueCol: string | null, stageCol: string | null, period: Period, customRange?: { start: Date; end: Date }) {
  const start = customRange ? customRange.start : (period === "custom" ? new Date(0) : periodStart(period));
  const buckets: Map<string, { revenue: number; count: number }> = new Map();
  for (const r of records) {
    const raw = r.updated_at ?? r.created_at ?? (r.data as Record<string,unknown>).created_at ?? (r.data as Record<string,unknown>).updated_at;
    if (!raw) continue;
    const d = new Date(raw as string);
    if (d < start) continue;
    if (customRange && d > customRange.end) continue;
    const stage = stageCol ? String(r.data[stageCol] ?? "") : "";
    const val   = valueCol ? Number(r.data[valueCol] ?? 0) : 0;
    const label = bucketLabel(d, period);
    const existing = buckets.get(label) ?? { revenue: 0, count: 0 };
    if (!stageCol || isWon(stage)) { existing.revenue += isNaN(val) ? 0 : val; existing.count += 1; }
    buckets.set(label, existing);
  }
  return Array.from(buckets.entries())
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([label,{revenue,count}]) => ({ label, revenue, count }));
}

function computeStats(records: NodeRecord[], valueCol: string | null, stageCol: string | null, period: Period, rangeOverride?: { start: Date; end: Date }) {
  const start = rangeOverride ? rangeOverride.start : periodStart(period);
  const end   = rangeOverride ? rangeOverride.end   : new Date();
  const inPeriod = records.filter(r => {
    const raw = r.updated_at ?? r.created_at ?? (r.data as Record<string,unknown>).updated_at ?? (r.data as Record<string,unknown>).created_at;
    if (!raw) return !rangeOverride;
    const d = new Date(raw as string);
    return d >= start && d <= end;
  });
  const getVal   = (r: NodeRecord) => { const v = valueCol ? r.data[valueCol] : undefined; const n = Number(v ?? 0); return isNaN(n) ? 0 : n; };
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
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${up ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"}`}>
      {up ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}
      {up ? "+" : ""}{delta}%
    </span>
  );
}

function GoalBar({ value, goal }: { value: number; goal: number }) {
  const pct = Math.min(100, Math.round(value / goal * 100));
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[10px] text-white/40 mb-1">
        <span>{pct}% of goal</span>
        <span>{fmtMoney(goal)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10">
        <div className="h-1.5 rounded-full bg-current transition-all" style={{ width: `${pct}%` }}/>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, color, trend, delta, goal, goalValue, onSetGoal }: {
  label: string; value: string; sub?: string; color: string; trend?: "up"|"down"|"neutral";
  delta?: number | null; goal?: number | null; goalValue?: number; onSetGoal?: () => void;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border p-5 print:border-gray-200 ${color}`}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl print:hidden" style={{ background:"currentColor" }}/>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-current opacity-60">{label}</p>
        {onSetGoal && (
          <button onClick={onSetGoal} title="Set goal" className="text-current opacity-30 hover:opacity-60 transition-opacity print:hidden">
            <Target size={12}/>
          </button>
        )}
      </div>
      <p className="mt-2 text-3xl font-bold text-white leading-none print:text-black">{value}</p>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {delta != null && <DeltaBadge delta={delta}/>}
        {sub && (
          <div className="flex items-center gap-1 text-[11px] text-white/50 print:text-gray-500">
            {trend === "up"      && <TrendingUp  size={11} className="text-emerald-400"/>}
            {trend === "down"    && <TrendingDown size={11} className="text-indigo-400"/>}
            {trend === "neutral" && <Minus size={11}/>}
            {sub}
          </div>
        )}
      </div>
      {goal != null && goalValue != null && <GoalBar value={goalValue} goal={goal}/>}
    </div>
  );
}

function ObjectPicker({ objects, value, onChange }: {
  objects: Array<{ slug: string; name_plural: string }>;
  value: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = objects.find(o => o.slug === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-sm text-white hover:bg-white/[.06] transition-colors"
      >
        {selected?.name_plural ?? value}
        <ChevronDown size={13} className="text-stone-500"/>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)}/>
          <div className="dropdown-panel absolute left-0 top-10 z-20 min-w-[160px]">
            {objects.map(o => (
              <button
                key={o.slug}
                onClick={() => { onChange(o.slug); setOpen(false); }}
                className={`dropdown-item w-full text-sm ${o.slug === value ? "text-indigo-400 font-medium" : ""}`}
              >
                {o.name_plural}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DrillPanel({ record, nameCol, onClose }: { record: NodeRecord; nameCol: string; onClose: () => void }) {
  const name = String(record.data[nameCol] ?? "Record");
  const fields = Object.entries(record.data).filter(([,v]) => v != null && v !== "");
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div className="w-full max-w-md overflow-y-auto bg-[#0d0f13] border-l border-white/[.09] p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-semibold text-white truncate">{name}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-white transition-colors">
            <X size={16}/>
          </button>
        </div>
        <div className="space-y-3">
          {fields.map(([key, val]) => (
            <div key={key} className="flex items-start gap-3">
              <span className="min-w-[120px] text-[11px] font-medium uppercase tracking-wide text-stone-600 pt-0.5">{key}</span>
              <span className="text-sm text-stone-300 break-all">{String(val)}</span>
            </div>
          ))}
          <div className="pt-3 border-t border-white/[.06]">
            <div className="flex items-start gap-3">
              <span className="min-w-[120px] text-[11px] font-medium uppercase tracking-wide text-stone-600 pt-0.5">Created</span>
              <span className="text-sm text-stone-300">{record.created_at ? new Date(record.created_at).toLocaleString() : "—"}</span>
            </div>
            <div className="flex items-start gap-3 mt-2">
              <span className="min-w-[120px] text-[11px] font-medium uppercase tracking-wide text-stone-600 pt-0.5">Updated</span>
              <span className="text-sm text-stone-300">{record.updated_at ? new Date(record.updated_at).toLocaleString() : "—"}</span>
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
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"/>
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-white/[.09] bg-[#0d0f13] shadow-[0_24px_80px_rgba(0,0,0,0.7)] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[.07] shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/20">
            <Sparkles size={13} className="text-violet-400"/>
          </div>
          <span className="flex-1 text-sm font-semibold text-white">{title}</span>
          {onPrint && (
            <button onClick={onPrint}
              className="flex items-center gap-1.5 rounded-lg border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-[11px] text-stone-400 hover:text-white transition-colors">
              <Printer size={11}/> Export
            </button>
          )}
          <button onClick={onClose} className="rounded-lg p-1.5 text-stone-600 hover:text-white transition-colors">
            <X size={14}/>
          </button>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── AI Forecast Card ─────────────────────────────────────────────────────────
interface ForecastAction { action: string; impact: "high"|"medium"|"low"; why: string }
interface ForecastResult { projectedValue: number; confidence: "high"|"medium"|"low"; headline: string; narrative: string; risks: string; actions?: ForecastAction[] }

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  low:    "border-indigo-500/30 bg-indigo-500/10 text-indigo-400",
};

function AIForecastCard({ objectType, valueCol, stageCol, period, stats, prevStats, trendData }: {
  objectType: string; valueCol: string | null; stageCol: string | null; period: Period;
  stats: ReturnType<typeof computeStats>; prevStats: ReturnType<typeof computeStats>;
  trendData: { label: string; revenue: number; count: number }[];
}) {
  const [result, setResult]   = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const hasValue = !!valueCol;

  async function runForecast() {
    setLoading(true); setError(null); setModalOpen(true);
    try {
      const res = await apiClient.post<ForecastResult>("/generate/forecast", {
        objectType, valueCol, stageCol, period,
        stats: { wonValue: stats.wonValue, openValue: stats.openValue, wonCount: stats.wonCount, openCount: stats.openCount, totalCount: stats.totalCount, completionRate: stats.completionRate, avgVal: stats.avgVal },
        prevStats: { wonValue: prevStats.wonValue, wonCount: prevStats.wonCount, completionRate: prevStats.completionRate },
        trendData,
      });
      setResult(res);
    } catch (e: any) {
      let msg = e?.message ?? "Forecast unavailable.";
      try { const j = JSON.parse(msg); msg = j.error ?? msg; } catch {}
      setError(msg); setModalOpen(false);
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
.medium{border-color:#fcd34d;color:#d97706;background:#fffbeb}
.low{border-color:#fca5a5;color:#dc2626;background:#fef2f2}
.section{margin-bottom:20px}
.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;margin-bottom:6px}
p{font-size:13px;color:#374151;line-height:1.6}
.risk{background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:4px;font-size:12px;color:#92400e}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
</style></head><body>
<h1>AI Forecast</h1>
<p class="meta">${objectType} · ${PERIOD_LABELS[period]} · Generated ${new Date().toLocaleDateString([], {year:"numeric",month:"long",day:"numeric"})}</p>
<div class="label">Projected ${hasValue ? "Revenue" : "Completions"}</div>
<div class="big">${hasValue ? fmtMoney(result.projectedValue) : fmtNum(result.projectedValue)}</div>
<span class="badge ${result.confidence}">${result.confidence.charAt(0).toUpperCase()+result.confidence.slice(1)} Confidence</span>
<div class="section"><div class="section-title">Headline</div><p><em>${result.headline}</em></p></div>
<div class="section"><div class="section-title">Analysis</div><p>${result.narrative}</p></div>
${result.risks && result.risks !== "None identified" ? `<div class="risk"><strong>Risk:</strong> ${result.risks}</div>` : ""}
${result.actions && result.actions.length > 0 ? `<div class="section" style="margin-top:24px"><div class="section-title">What to do now</div><div style="display:flex;flex-direction:column;gap:8px">${result.actions.map(a=>`<div style="display:flex;align-items:flex-start;gap:10px;border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px"><span style="font-size:9px;font-weight:700;border-radius:99px;border:1px solid;padding:2px 8px;white-space:nowrap;${a.impact==="high"?"border-color:#6ee7b7;color:#059669;background:#ecfdf5":a.impact==="medium"?"border-color:#fcd34d;color:#d97706;background:#fffbeb":"border-color:#d1d5db;color:#6b7280;background:#f9fafb"}">${a.impact}</span><div><div style="font-size:13px;font-weight:600;color:#111;margin-bottom:2px">${a.action}</div><div style="font-size:11px;color:#6b7280">${a.why}</div></div></div>`).join("")}</div></div>` : ""}
<div class="footer"><span>Mondaily AI · AI Forecast</span><span>${new Date().toLocaleDateString()}</span></div>
<script>window.onload=()=>window.print()<\/script></body></html>`;
    const w = window.open("","_blank"); if(w){w.document.write(html);w.document.close();}
  }

  return (
    <>
      {/* Compact trigger card — never stretches */}
      <div className="rounded-2xl border border-violet-500/20 bg-[#0d0f13] p-5 flex items-center gap-4 print:hidden" style={{background:"linear-gradient(135deg,rgba(139,92,246,0.07) 0%,rgba(59,130,246,0.04) 100%)"}}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/25">
          <Sparkles size={16} className="text-violet-400"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">AI Forecast</p>
          <p className="text-[11px] text-stone-500 mt-0.5">
            {result ? <span className="text-violet-300 italic">{result.headline}</span>
                    : `Project ${hasValue?"revenue":"completions"} with Mondaily AI`}
          </p>
        </div>
        {loading ? (
          <Loader2 size={15} className="animate-spin text-violet-400 shrink-0"/>
        ) : error ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-indigo-400 max-w-[160px] truncate">{error}</span>
            <button onClick={() => { setError(null); runForecast(); }} className="text-[11px] text-stone-500 hover:text-white">Retry</button>
          </div>
        ) : result ? (
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right mr-1">
              <p className="text-[10px] text-stone-500 uppercase tracking-wider">Projected</p>
              <p className="text-base font-bold text-white">{hasValue ? fmtMoney(result.projectedValue) : fmtNum(result.projectedValue)}</p>
            </div>
            <button onClick={() => setModalOpen(true)} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/20 transition-colors">View</button>
            <button onClick={() => { setResult(null); runForecast(); }} className="rounded-lg border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-xs text-stone-500 hover:text-white transition-colors">↺</button>
          </div>
        ) : (
          <button onClick={runForecast} className="shrink-0 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 transition-colors">
            Generate
          </button>
        )}
      </div>

      {/* Result modal */}
      {modalOpen && result && (
        <AIModal title="AI Forecast" onClose={() => setModalOpen(false)} onPrint={printForecast}>
          {/* Projected value hero */}
          <div className="px-6 py-6 border-b border-white/[.06]" style={{background:"linear-gradient(135deg,rgba(139,92,246,0.08) 0%,rgba(59,130,246,0.04) 100%)"}}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-500 mb-1">Projected {hasValue ? "Revenue" : "Completions"}</p>
            <p className="text-4xl font-bold text-white mb-2">{hasValue ? fmtMoney(result.projectedValue) : fmtNum(result.projectedValue)}</p>
            <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${CONFIDENCE_STYLE[result.confidence] ?? CONFIDENCE_STYLE.medium}`}>
              {result.confidence} confidence
            </span>
          </div>
          {/* Headline */}
          <div className="px-6 py-4 border-b border-white/[.05]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mb-1.5">Headline</p>
            <p className="text-sm text-stone-300 italic leading-relaxed">{result.headline}</p>
          </div>
          {/* Narrative */}
          <div className="px-6 py-4 border-b border-white/[.05]">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mb-1.5">Analysis</p>
            <p className="text-sm text-stone-300 leading-relaxed">{result.narrative}</p>
          </div>
          {/* Risk */}
          {result.risks && result.risks !== "None identified" && (
            <div className="mx-6 my-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[.06] px-4 py-3">
              <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5"/>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-500 mb-0.5">Risk</p>
                <p className="text-sm text-amber-300/80 leading-relaxed">{result.risks}</p>
              </div>
            </div>
          )}
          {/* Actions */}
          {result.actions && result.actions.length > 0 && (
            <div className="px-6 py-4 border-t border-white/[.05]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mb-3">What to do now</p>
              <div className="space-y-2">
                {result.actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3">
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      a.impact === "high"   ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" :
                      a.impact === "medium" ? "border-amber-500/30 bg-amber-500/10 text-amber-400" :
                                              "border-stone-500/30 bg-stone-500/10 text-stone-400"
                    }`}>{a.impact}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white font-medium">{a.action}</p>
                      <p className="text-[11px] text-stone-500 mt-0.5">{a.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="px-6 py-3 flex items-center justify-between border-t border-white/[.05]">
            <span className="text-[10px] text-stone-700">Powered by Mondaily AI</span>
            <button onClick={() => { setResult(null); setModalOpen(false); runForecast(); }} className="text-[11px] text-stone-600 hover:text-violet-400 transition-colors">↺ Regenerate</button>
          </div>
        </AIModal>
      )}
    </>
  );
}

interface AIInsight { title: string; value: string; trend?: "up"|"down"|"neutral"; description: string; category: "performance"|"risk"|"opportunity"|"summary"; action?: string }

function AIInsightsPanel({ records, objectType }: { records: NodeRecord[]; objectType: string }) {
  const [loading, setLoading]   = useState(false);
  const [insights, setInsights] = useState<AIInsight[] | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const CATEGORY_META = {
    performance: { label: "Performance", dot: "bg-emerald-400", border: "border-emerald-500/25", bg: "bg-emerald-500/[.06]", text: "text-emerald-400" },
    opportunity: { label: "Opportunity", dot: "bg-blue-400",    border: "border-blue-500/25",    bg: "bg-blue-500/[.06]",    text: "text-blue-400"    },
    risk:        { label: "Risk",        dot: "bg-indigo-400",     border: "border-indigo-500/25",     bg: "bg-indigo-500/[.06]",     text: "text-indigo-400"     },
    summary:     { label: "Summary",     dot: "bg-violet-400",  border: "border-violet-500/25",  bg: "bg-violet-500/[.06]",  text: "text-violet-400"  },
  } as const;
  type Cat = keyof typeof CATEGORY_META;
  const fallbackMeta = CATEGORY_META.summary;

  // Reset when the object type the panel is analysing changes
  useEffect(() => {
    setInsights(null);
    setError(null);
    setModalOpen(false);
  }, [objectType]);

  async function run() {
    if (insights) { setModalOpen(true); return; }
    setLoading(true); setError(null);
    try {
      const res = await apiClient.post<{ insights: AIInsight[] }>("/generate/insights", { objectType, records: records.slice(0, 50) });
      setInsights(res.insights ?? []);
      setModalOpen(true);
    } catch (e: any) {
      let msg = e?.message ?? "Could not load AI insights.";
      try { const j = JSON.parse(msg); msg = j.error ?? msg; } catch {}
      setError(msg);
    } finally { setLoading(false); }
  }

  function printInsights() {
    if (!insights) return;
    const cards = insights.map(ins => {
      const cat = ins.category as Cat;
      const colors: Record<Cat, string> = { performance:"#059669", opportunity:"#2563eb", risk:"#dc2626", summary:"#7c3aed" };
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
      {/* Compact trigger card */}
      <div className="rounded-2xl border border-white/[.08] bg-[#0d0f13] p-5 flex items-center gap-4 print:hidden">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/25">
          <Sparkles size={16} className="text-violet-400"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">AI Insights</p>
          <p className="text-[11px] text-stone-500 mt-0.5">
            {insights ? `${insights.length} insights ready` : "Surface patterns in your data with Mondaily AI"}
          </p>
        </div>
        {loading ? (
          <Loader2 size={15} className="animate-spin text-violet-400 shrink-0"/>
        ) : error ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-indigo-400 max-w-[160px] truncate">{error}</span>
            <button onClick={() => { setError(null); run(); }} className="text-[11px] text-stone-500 hover:text-white">Retry</button>
          </div>
        ) : insights ? (
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setModalOpen(true)} className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-300 hover:bg-violet-500/20 transition-colors">View</button>
            <button onClick={() => { setInsights(null); run(); }} className="rounded-lg border border-white/[.08] bg-white/[.03] px-2.5 py-1.5 text-xs text-stone-500 hover:text-white transition-colors">↺</button>
          </div>
        ) : (
          <button onClick={run} className="shrink-0 rounded-lg bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 transition-colors">
            Analyse
          </button>
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
                <div key={i} className={`rounded-xl border ${m.border} ${m.bg} p-4 flex flex-col gap-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${m.dot}`}/>
                      <span className={`text-[10px] font-semibold uppercase tracking-widest ${m.text}`}>{m.label}</span>
                    </div>
                    {ins.trend === "up"   && <TrendingUp  size={12} className="text-emerald-400 shrink-0"/>}
                    {ins.trend === "down" && <TrendingDown size={12} className="text-indigo-400 shrink-0"/>}
                  </div>
                  <div>
                    <p className="text-[11px] text-stone-500 mb-0.5">{ins.title}</p>
                    <p className="text-2xl font-bold text-white leading-tight">{ins.value}</p>
                  </div>
                  <p className="text-[11px] text-stone-400 leading-relaxed">{ins.description}</p>
                  {ins.action && (
                    <div className="flex items-start gap-1.5 mt-1 pt-2 border-t border-white/[.06]">
                      <span className="text-[10px] shrink-0 text-stone-600 mt-0.5">→</span>
                      <p className="text-[11px] text-stone-400 leading-relaxed">{ins.action}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-5 py-3 flex items-center justify-between border-t border-white/[.05]">
            <span className="text-[10px] text-stone-700">Powered by Mondaily AI · {records.length} records</span>
            <button onClick={() => { setInsights(null); setModalOpen(false); run(); }} className="text-[11px] text-stone-600 hover:text-violet-400 transition-colors">↺ Regenerate</button>
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
        className="flex items-center gap-2 rounded-lg border border-white/[.08] bg-white/[.02] px-3 py-2 text-xs text-stone-400 hover:text-white transition-colors"
      >
        <Mail size={12}/> Schedule digest {digests.length > 0 && <span className="rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 text-[10px]">{digests.length}</span>}
      </button>

      {open && (
        <div className="mt-3 rounded-2xl border border-white/[.09] bg-[#0d0f13] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          <div className="px-5 py-4 border-b border-white/[.06]">
            <h3 className="text-sm font-semibold text-white mb-1">Scheduled email digests</h3>
            <p className="text-[11px] text-stone-500">Receive a KPI snapshot for <strong className="text-stone-400">{objName}</strong> on a schedule.</p>
          </div>

          {/* Existing digests */}
          {digests.length > 0 && (
            <div className="px-5 py-3 space-y-2 border-b border-white/[.06]">
              {digests.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2.5">
                  <Mail size={12} className="text-indigo-400 shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{FREQ_LABELS[d.frequency]} · {d.period} view</p>
                    <p className="text-[10px] text-stone-500 truncate">{d.recipients.join(", ")}</p>
                  </div>
                  {sentMsg && sending === null && d.id === digests[0]?.id && (
                    <span className="text-[10px] text-emerald-400">{sentMsg}</span>
                  )}
                  <button
                    onClick={() => sendNow(d.id)}
                    disabled={sending === d.id}
                    className="text-[11px] text-stone-500 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {sending === d.id ? <Loader2 size={11} className="animate-spin"/> : "Send now"}
                  </button>
                  <button onClick={() => remove.mutate(d.id)} className="text-stone-600 hover:text-indigo-400 transition-colors">
                    <Trash2 size={12}/>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Create form */}
          <div className="px-5 py-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-600">New schedule</p>

            <div className="grid grid-cols-3 gap-2">
              {(["daily","weekly","monthly"] as const).map(f => (
                <button key={f} onClick={() => setFreq(f)}
                  className={`rounded-lg border py-2 text-xs font-medium transition-colors ${freq===f ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400" : "border-white/[.08] text-stone-500 hover:text-white"}`}>
                  {FREQ_LABELS[f]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {freq === "weekly" && (
                <div>
                  <label className="block text-[10px] font-medium text-stone-600 mb-1">Day</label>
                  <select value={dayOfWeek} onChange={e => setDayOfWeek(Number(e.target.value))}
                    className="w-full h-8 rounded-lg border border-white/[.08] bg-[#0d0f13] px-2 text-xs text-stone-300 focus:outline-none">
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-[10px] font-medium text-stone-600 mb-1">Hour (24h)</label>
                <select value={hour} onChange={e => setHour(Number(e.target.value))}
                  className="w-full h-8 rounded-lg border border-white/[.08] bg-[#0d0f13] px-2 text-xs text-stone-300 focus:outline-none">
                  {Array.from({length:24},(_,i) => <option key={i} value={i}>{String(i).padStart(2,"0")}:00</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-stone-600 mb-1">Period view</label>
                <select value={period} onChange={e => setPeriodD(e.target.value as typeof period)}
                  className="w-full h-8 rounded-lg border border-white/[.08] bg-[#0d0f13] px-2 text-xs text-stone-300 focus:outline-none">
                  {(["today","week","month","quarter","year"] as const).map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-stone-600 mb-1">Recipients</label>
              <div className="flex gap-1.5">
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addEmail(); } }}
                  placeholder="email@example.com"
                  className="flex-1 h-8 rounded-lg border border-white/[.08] bg-[#0d0f13] px-2 text-xs text-stone-300 placeholder-stone-700 focus:outline-none focus:border-indigo-500/40"
                />
                <button onClick={addEmail} className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/[.08] text-stone-500 hover:text-white transition-colors">
                  <Plus size={12}/>
                </button>
              </div>
              {emails.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {emails.map(e => (
                    <span key={e} className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[.03] px-2 py-0.5 text-[10px] text-stone-400">
                      {e}
                      <button onClick={() => setEmails(arr => arr.filter(x => x !== e))} className="text-stone-600 hover:text-indigo-400"><X size={9}/></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => create.mutate({ object_type: objectType, period, frequency: freq, day_of_week: freq === "weekly" ? dayOfWeek : undefined, hour, recipients: emails })}
              disabled={emails.length === 0 || create.isPending}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
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

  const stats     = useMemo(() => computeStats(filteredRecords, valueCol, stageCol, period, customRange), [filteredRecords, period, valueCol, stageCol, customRange]);
  const prevStats = useMemo(() => {
    if (period === "custom" && customRange) {
      const dur = customRange.end.getTime() - customRange.start.getTime();
      return computeStats(filteredRecords, valueCol, stageCol, period, { start: new Date(customRange.start.getTime() - dur), end: customRange.start });
    }
    const range = prevPeriodRange(period as Exclude<Period, "custom">);
    return computeStats(filteredRecords, valueCol, stageCol, period, range);
  }, [filteredRecords, period, valueCol, stageCol, customRange]);

  const stageData = useMemo(() => {
    if (!stageCol) return [];
    const counts: Record<string, { count: number; value: number }> = {};
    for (const r of filteredRecords) {
      const s = String(r.data[stageCol] ?? "Unknown");
      const v = valueCol ? Number(r.data[valueCol] ?? 0) : 0;
      counts[s] = counts[s] ?? { count: 0, value: 0 };
      counts[s].count++;
      counts[s].value += isNaN(v) ? 0 : v;
    }
    return Object.entries(counts)
      .map(([label,{count,value}]) => ({ label, count, value }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredRecords, stageCol, valueCol]);

  const trendData = useMemo(() => buildTrend(filteredRecords, valueCol, stageCol, period, customRange), [filteredRecords, valueCol, stageCol, period, customRange]);


  const topRecords = useMemo(() => {
    if (!valueCol) return filteredRecords.slice(0, 10);
    return [...filteredRecords]
      .filter(r => r.data[valueCol] != null)
      .sort((a,b) => Number(b.data[valueCol] ?? 0) - Number(a.data[valueCol] ?? 0))
      .slice(0, 10);
  }, [filteredRecords, valueCol]);

  function generateReport() {
    const periodLabel = period === "custom" && customStart && customEnd
      ? `${customStart} – ${customEnd}`
      : PERIOD_LABELS[period];
    const totalValue = hasValue
      ? topRecords.reduce((s, r) => s + (isNaN(Number(r.data[valueCol!] ?? 0)) ? 0 : Number(r.data[valueCol!] ?? 0)), 0)
      : 0;
    const maxVal = hasValue ? Math.max(...topRecords.map(r => Number(r.data[valueCol!] ?? 0)).filter(v => !isNaN(v)), 1) : 1;

    const rows = topRecords.map((r, i) => {
      const name  = String(r.data[nameCol] ?? "—");
      const stage = hasStage ? String(r.data[stageCol!] ?? "—") : "";
      const val   = hasValue ? Number(r.data[valueCol!] ?? 0) : 0;
      const pct   = hasValue && !isNaN(val) ? Math.round((val / maxVal) * 100) : 0;
      return `
        <tr>
          <td class="rank">${i + 1}</td>
          <td class="name">${name}</td>
          ${hasStage ? `<td class="stage">${stage}</td>` : ""}
          ${hasValue ? `<td class="value">${fmtMoney(isNaN(val) ? 0 : val)}</td>` : ""}
          ${hasValue ? `<td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td>` : ""}
        </tr>`;
    }).join("");

    const trendRows = trendData.map(d => `
      <tr>
        <td>${d.label}</td>
        ${hasValue ? `<td class="num">${fmtMoney(d.revenue)}</td>` : ""}
        <td class="num">${d.count}</td>
      </tr>`).join("");

    const kpis = [
      { label: hasValue ? (hasStage ? "Won Value" : "Total Value") : "Total Records", value: hasValue ? fmtMoney(stats.wonValue || stats.totalValue) : fmtNum(stats.totalCount) },
      { label: hasStage ? "In Progress" : "This Period", value: hasValue ? fmtMoney(stats.openValue) : fmtNum(stats.openCount || stats.totalCount) },
      { label: hasStage ? "Completion Rate" : "Total Records", value: hasStage ? `${stats.completionRate}%` : fmtNum(stats.totalCount) },
      { label: hasValue ? `Avg ${valueCol}` : "Avg / Bucket", value: hasValue ? fmtMoney(stats.avgVal) : fmtNum(stats.avgVal) },
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
    tr:nth-child(1) .rank { color: #f59e0b; }
    tr:nth-child(2) .rank { color: #9ca3af; }
    tr:nth-child(3) .rank { color: #cd7c43; }
    .name { font-weight: 600; color: #111; }
    .stage { font-size: 11px; color: #6b7280; }
    .value { font-weight: 700; color: #111; text-align: right; font-variant-numeric: tabular-nums; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .bar-cell { width: 100px; }
    .bar-track { height: 5px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #4f46e5); border-radius: 99px; }
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
    ${hasValue ? `<tfoot><tr><td colspan="${1 + (hasStage ? 1 : 0) + 1}" class="tfoot">Total</td><td class="tfoot value">${fmtMoney(totalValue)}</td><td></td></tr></tfoot>` : ""}
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
    <div className="min-h-full bg-[#0d0f13] print:bg-white text-white print:text-black">
      {/* Print header */}
      <div className="hidden print:flex items-center justify-between px-8 py-6 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-black">Live Report — {objLabel}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{PERIOD_LABELS[period]} · Generated {now}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-black">Mondaily</p>
          <p className="text-xs text-gray-500">Business Intelligence</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 print:max-w-none print:px-8">
        {/* Screen header */}
        {/* Header row */}
        <div className="mb-4 flex items-center gap-3 print:hidden">
          <Link to="/reports" className="flex items-center gap-1 text-xs text-stone-600 hover:text-white transition-colors shrink-0">
            <ArrowLeft size={12}/> Reports
          </Link>
          <span className="text-stone-700 text-xs shrink-0">/</span>
          <h1 className="text-sm font-semibold text-white shrink-0">Live Report</h1>
          {objects.length > 0 && <ObjectPicker objects={objects} value={activeSlug} onChange={handleObjectChange}/>}
          <span className="text-xs text-stone-700 hidden sm:inline">
            {records.length} records{filteredRecords.length !== records.length && ` · ${filteredRecords.length} filtered`}
          </span>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">
            {/* Period buttons */}
            <div className="flex gap-0.5 rounded-lg border border-white/[.06] bg-white/[.02] p-0.5">
              {(["today","week","month","quarter","year","custom"] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${period===p ? "bg-white/10 text-white" : "text-stone-500 hover:text-stone-300"}`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <button onClick={exportCSV}
              className="flex items-center gap-1 rounded-lg border border-white/[.06] bg-white/[.02] px-2.5 py-1 text-xs text-stone-400 hover:text-white transition-colors">
              <Download size={12}/> CSV
            </button>
            <button onClick={generateReport}
              className="flex items-center gap-1 rounded-lg border border-white/[.06] bg-white/[.02] px-2.5 py-1 text-xs text-stone-400 hover:text-white transition-colors">
              <Printer size={12}/> Export
            </button>
          </div>
        </div>

        {/* Custom date range row — only shown when Custom period is active */}
        {period === "custom" && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2.5 print:hidden">
            <span className="text-[11px] font-medium text-stone-500 shrink-0">Date range</span>
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="h-7 rounded-md border border-white/[.06] bg-[#0d0f13] px-2 text-xs text-stone-300 [color-scheme:dark] outline-none focus:border-blue-500/40"/>
              <span className="text-xs text-stone-600">→</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="h-7 rounded-md border border-white/[.06] bg-[#0d0f13] px-2 text-xs text-stone-300 [color-scheme:dark] outline-none focus:border-blue-500/40"/>
            </div>
            {customStart && customEnd && (
              <span className="ml-auto text-[11px] text-stone-600">
                {new Date(customStart).toLocaleDateString(undefined,{month:"short",day:"numeric"})} – {new Date(customEnd).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}
              </span>
            )}
          </div>
        )}

        {/* Digest scheduler */}
        <DigestPanel objectType={activeSlug} objects={objects}/>

        {/* Filter presets row */}
        {(hasFilters && (presets.length > 0 || filtersActive)) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 print:hidden">
            <Bookmark size={11} className="text-stone-600 shrink-0"/>
            <span className="text-[10px] font-medium text-stone-600 mr-0.5">Presets</span>
            {presets.map(p => {
              const active = JSON.stringify(activeFilters) === JSON.stringify(p.filters);
              return (
                <span key={p.id} className={`group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-pointer transition-colors ${active ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-white/[.08] bg-white/[.02] text-stone-400 hover:text-white hover:border-white/20"}`}
                  onClick={() => applyPreset(p)}>
                  {p.name}
                  <button onClick={e => { e.stopPropagation(); deletePreset(p.id); }}
                    className="opacity-0 group-hover:opacity-100 ml-0.5 text-stone-600 hover:text-indigo-400 transition-all">
                    <X size={9}/>
                  </button>
                </span>
              );
            })}
            {filtersActive && !savingPreset && (
              <button onClick={() => setSavingPreset(true)}
                className="flex items-center gap-1 rounded-full border border-dashed border-white/[.12] px-2 py-0.5 text-[11px] text-stone-600 hover:text-white hover:border-white/30 transition-colors">
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
                  className="h-6 rounded-md border border-blue-500/30 bg-[#0d0f13] px-2 text-[11px] text-white placeholder-stone-600 outline-none focus:border-blue-500/50 w-36"
                />
                <button onClick={() => { if (presetName.trim()) savePreset(presetName.trim()); }}
                  disabled={!presetName.trim()}
                  className="h-6 rounded-md bg-blue-600 px-2 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40 transition-colors">
                  Save
                </button>
                <button onClick={() => { setSavingPreset(false); setPresetName(""); }} className="text-stone-600 hover:text-white transition-colors"><X size={11}/></button>
              </div>
            )}
          </div>
        )}

        {/* Filter bar */}
        {hasFilters && (
          <div className={`mb-4 print:hidden rounded-xl border transition-colors ${filtersActive ? "border-blue-500/20 bg-blue-500/[.03]" : "border-white/[.06] bg-white/[.02]"}`}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[.05]">
              <Filter size={11} className="text-stone-500 shrink-0"/>
              <span className="text-[11px] font-medium text-stone-500">Filters</span>
              {filtersActive ? (
                <>
                  <span className="rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold px-1.5 py-0.5 ml-0.5">
                    {Object.values(activeFilters).filter(Boolean).length}
                  </span>
                  <button onClick={() => setActiveFilters({})} className="ml-auto text-[11px] text-stone-600 hover:text-indigo-400 transition-colors">
                    Clear
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-stone-700 ml-1">— select to narrow results</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-3 gap-y-2.5 p-3">
              {filterableCols.map(col => {
                const uniqueVals = [...new Set(records.map(r => String(r.data[col] ?? "")).filter(Boolean))].sort();
                const active = !!activeFilters[col];
                return (
                  <div key={col} className="flex flex-col gap-1 min-w-0">
                    <label className="text-[10px] font-medium uppercase tracking-widest text-stone-600 truncate">{col.replace(/_/g," ")}</label>
                    <select
                      value={activeFilters[col] ?? ""}
                      onChange={e => setActiveFilters(f => ({ ...f, [col]: e.target.value }))}
                      className={`h-7 w-full rounded-md border px-2 text-[11px] focus:outline-none transition-colors truncate ${active ? "border-blue-500/40 bg-blue-500/10 text-blue-200" : "border-white/[.08] bg-[#0d0f13] text-stone-300 focus:border-blue-500/40"}`}
                    >
                      <option value="">All</option>
                      {uniqueVals.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Print period */}
        <div className="hidden print:block mb-6">
          <p className="text-sm font-semibold text-gray-700">{objLabel} — {period === "custom" && customStart && customEnd ? `${customStart} – ${customEnd}` : PERIOD_LABELS[period]}</p>
        </div>

        {recordsQ.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500/30 border-t-red-500"/>
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-stone-400 text-sm">No {objLabel} records found.</p>
            <Link to={`/objects/${activeSlug}`} className="text-sm text-indigo-400 hover:text-indigo-300">
              Go to {objLabel} →
            </Link>
            {objects.length > 1 && (
              <p className="text-xs text-stone-600">Or pick a different object type above</p>
            )}
          </div>
        ) : (
          <>
            {/* Goal dialog */}
            {editingGoal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="w-72 rounded-2xl border border-white/[.09] bg-[#0d0f13] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.7)]">
                  <h3 className="mb-3 text-sm font-semibold text-white">Set a goal for {vocab.kpi1Label}</h3>
                  <input
                    autoFocus
                    value={goalInput}
                    onChange={e => setGoalInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveGoal(); if (e.key === "Escape") setEditingGoal(false); }}
                    placeholder={hasValue ? "e.g. 100000" : "e.g. 500"}
                    className="key-input w-full mb-3"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveGoal} className="flex-1 rounded-md bg-indigo-600 py-2 text-xs font-medium text-white hover:bg-indigo-500">Set goal</button>
                    <button onClick={() => setEditingGoal(false)} className="rounded-md border border-white/[.06] px-3 py-2 text-xs text-stone-400 hover:text-white">Cancel</button>
                    {goal && <button onClick={() => { setGoal(null); setEditingGoal(false); }} className="rounded-md border border-white/10 px-3 py-2 text-xs text-stone-600 hover:text-stone-400">Clear</button>}
                  </div>
                </div>
              </div>
            )}

            {/* KPI Grid */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
              <KpiCard
                label={hasValue ? (hasStage ? "Won Value" : "Total Value") : "Total Records"}
                value={hasValue ? fmtMoney(stats.wonValue || stats.totalValue) : fmtNum(stats.totalCount)}
                sub={hasStage ? `${stats.wonCount} completed` : `${stats.totalCount} total`}
                color="border-emerald-500/20 bg-emerald-500/[.06] text-emerald-400"
                trend="up"
                delta={pctDelta(hasValue ? (stats.wonValue || stats.totalValue) : stats.totalCount, hasValue ? (prevStats.wonValue || prevStats.totalValue) : prevStats.totalCount)}
                goal={goal}
                goalValue={hasValue ? (stats.wonValue || stats.totalValue) : stats.totalCount}
                onSetGoal={() => setEditingGoal(true)}
              />
              <KpiCard
                label={hasStage ? "In Progress" : "This Period"}
                value={hasValue ? fmtMoney(stats.openValue) : fmtNum(stats.openCount || stats.totalCount)}
                sub={hasStage ? `${stats.openCount} open` : "active records"}
                color="border-blue-500/20 bg-blue-500/[.06] text-blue-400"
                trend="neutral"
                delta={pctDelta(hasValue ? stats.openValue : stats.openCount, hasValue ? prevStats.openValue : prevStats.openCount)}
              />
              <KpiCard
                label={hasStage ? "Completion Rate" : "Total This Period"}
                value={hasStage ? `${stats.completionRate}%` : fmtNum(stats.totalCount)}
                sub={hasStage ? "closed won vs. all closed" : `across ${PERIOD_LABELS[period].toLowerCase()}`}
                color="border-violet-500/20 bg-violet-500/[.06] text-violet-400"
                trend={hasStage ? (stats.completionRate >= 50 ? "up" : "down") : "neutral"}
                delta={pctDelta(stats.completionRate, prevStats.completionRate)}
              />
              <KpiCard
                label={hasValue ? `Avg ${valueCol}` : "Avg per bucket"}
                value={hasValue ? fmtMoney(stats.avgVal) : fmtNum(stats.totalCount ? Math.round(stats.totalCount / Math.max(trendData.length, 1)) : 0)}
                sub="per record"
                color="border-amber-500/20 bg-amber-500/[.06] text-amber-400"
                delta={pctDelta(stats.avgVal, prevStats.avgVal)}
              />
              <KpiCard
                label="Total Records"
                value={fmtNum(stats.totalCount)}
                sub="in this period"
                color="border-rose-500/20 bg-rose-500/[.06] text-rose-400"
                delta={pctDelta(stats.totalCount, prevStats.totalCount)}
              />
              <KpiCard
                label={hasStage ? "Open / Active" : "All Time"}
                value={fmtNum(hasStage ? stats.openCount : records.length)}
                sub={hasStage ? "in pipeline" : "records total"}
                color="border-cyan-500/20 bg-cyan-500/[.06] text-cyan-400"
              />
            </div>

            {/* AI Panels — side by side */}
            <div className="mb-6 grid gap-4 lg:grid-cols-2 print:hidden">
              <AIForecastCard
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
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold print:text-black">{vocab.trendLabel}</h3>
                  <span className="text-[10px] text-stone-600 print:hidden">Clean trend</span>
                </div>
                {trendData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-stone-600">No data for this period</div>
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
                        <span className="text-stone-400">{a.bucket_label}:</span>
                        {a.text}
                        <button onClick={() => deleteAnnotation.mutate(a.id)} className="ml-0.5 opacity-0 group-hover:opacity-100 text-stone-600 hover:text-indigo-400 transition-all">
                          <X size={9}/>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">{vocab.stageLabel}</h3>
                {stageData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-stone-600">
                    {hasStage ? "No stage data" : `No "${stageCol ?? "status"}" column detected`}
                  </div>
                ) : (
                  <Sparkline values={stageData.map(item => item.count)} />
                )}
              </div>

              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Activity Over Time</h3>
                {trendData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-stone-600">No data for this period</div>
                ) : (
                  <Sparkline values={trendData.map(item => item.count)} />
                )}
              </div>

              {hasValue && hasStage && (
                <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">Value by {stageCol}</h3>
                  <Sparkline values={stageData.map(item => item.value)} />
                </div>
              )}

              {hasValue && !hasStage && (
                <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">{valueCol} Distribution</h3>
                  <Sparkline values={trendData.map(item => item.revenue)} />
                </div>
              )}
            </div>

            {/* Top Records List */}
            {(() => {
              const maxVal = hasValue
                ? Math.max(...topRecords.map(r => Number(r.data[valueCol!] ?? 0)).filter(v => !isNaN(v)), 1)
                : 1;
              const total = hasValue
                ? topRecords.reduce((s, r) => s + (isNaN(Number(r.data[valueCol!] ?? 0)) ? 0 : Number(r.data[valueCol!] ?? 0)), 0)
                : 0;
              const ROW_COLORS = [
                { bar: "from-violet-500 to-purple-400", badge: "bg-violet-500/15 text-violet-300 border-violet-500/20" },
                { bar: "from-blue-500 to-cyan-400",     badge: "bg-blue-500/15 text-blue-300 border-blue-500/20" },
                { bar: "from-emerald-500 to-teal-400",  badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
                { bar: "from-amber-500 to-yellow-400",  badge: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
                { bar: "from-rose-500 to-pink-400",     badge: "bg-rose-500/15 text-rose-300 border-rose-500/20" },
                { bar: "from-indigo-500 to-blue-400",   badge: "bg-indigo-500/15 text-indigo-300 border-indigo-500/20" },
                { bar: "from-teal-500 to-emerald-400",  badge: "bg-teal-500/15 text-teal-300 border-teal-500/20" },
                { bar: "from-orange-500 to-amber-400",  badge: "bg-orange-500/15 text-orange-300 border-orange-500/20" },
                { bar: "from-cyan-500 to-sky-400",      badge: "bg-cyan-500/15 text-cyan-300 border-cyan-500/20" },
                { bar: "from-fuchsia-500 to-purple-400",badge: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/20" },
              ];
              return (
                <div className="mb-6 rounded-xl border border-white/[.06] bg-white/[.02] overflow-hidden print:border-gray-200 print:bg-white">
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[.06]">
                    <h3 className="text-sm font-semibold text-white print:text-black">{vocab.tableLabel}</h3>
                    {hasValue && (
                      <span className="text-xs text-stone-500">
                        Total <span className="font-semibold text-stone-300 ml-1">{fmtMoney(total)}</span>
                      </span>
                    )}
                  </div>
                  {/* Column labels */}
                  <div className="grid px-5 py-2 border-b border-white/[.04]" style={{ gridTemplateColumns: hasValue ? "2rem 1fr auto auto" : "2rem 1fr auto" }}>
                    <span/>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-600">Name</span>
                    {hasStage && <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 mr-4">{stageCol?.replace(/_/g," ")}</span>}
                    {hasValue && <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-600 text-right">{valueCol?.replace(/_/g," ")}</span>}
                  </div>
                  {/* Rows */}
                  <div className="divide-y divide-white/[.03]">
                    {topRecords.map((r, i) => {
                      const stage   = hasStage ? String(r.data[stageCol!] ?? "—") : "";
                      const val     = hasValue ? Number(r.data[valueCol!] ?? 0) : 0;
                      const pct     = hasValue && !isNaN(val) ? Math.max(4, Math.round((val / maxVal) * 100)) : 0;
                      const won     = hasStage && isWon(stage);
                      const lost    = hasStage && isLost(stage);
                      const color   = ROW_COLORS[i % ROW_COLORS.length]!;
                      const rankColors = ["text-amber-400","text-stone-400","text-orange-600"];
                      return (
                        <div
                          key={r.id}
                          onClick={() => setDrillRecord(r)}
                          className="group relative cursor-pointer px-5 py-3 hover:bg-white/[.025] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {/* Rank */}
                            <span className={`w-7 shrink-0 text-center text-xs font-bold tabular-nums ${i < 3 ? rankColors[i] : "text-stone-600"}`}>
                              {i + 1}
                            </span>
                            {/* Name + bar */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm font-medium text-white truncate print:text-black">
                                  {String(r.data[nameCol] ?? "—")}
                                </span>
                                {hasValue && (
                                  <span className="ml-4 shrink-0 font-mono text-sm font-semibold text-white print:text-black">
                                    {fmtMoney(isNaN(val) ? 0 : val)}
                                  </span>
                                )}
                              </div>
                              {hasValue && (
                                <div className="h-1.5 w-full rounded-full bg-white/[.06] overflow-hidden">
                                  <div
                                    className={`h-full rounded-full bg-gradient-to-r ${color.bar} transition-all duration-500`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              )}
                            </div>
                            {/* Stage badge */}
                            {hasStage && (
                              <span className={`ml-3 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${won ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : lost ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" : color.badge} print:bg-transparent print:text-gray-600 print:border-gray-300`}>
                                {stage}
                              </span>
                            )}
                            <ChevronRight size={12} className="shrink-0 text-stone-700 group-hover:text-stone-400 transition-colors print:hidden"/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Footer total */}
                  {hasValue && (
                    <div className="flex items-center justify-between border-t border-white/[.06] px-5 py-3 print:border-gray-200">
                      <span className="text-xs text-stone-500">Top {topRecords.length} records</span>
                      <span className="font-mono text-sm font-bold text-white print:text-black">{fmtMoney(total)}</span>
                    </div>
                  )}
                </div>
              );
            })()}

          </>
        )}
      </div>

      {/* Print footer */}
      <div className="hidden print:flex mt-8 px-8 pb-6 border-t border-gray-200 pt-4 text-xs text-gray-400 justify-between">
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
