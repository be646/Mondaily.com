import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, FunnelChart, Funnel, LabelList,
} from "recharts";
import { useState, useMemo } from "react";
import { Printer, TrendingUp, TrendingDown, Minus, ArrowLeft, ChevronDown } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../../lib/api-client";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; created_at?: string; updated_at?: string }

type Period = "today" | "week" | "month" | "quarter" | "year";

// ─── Auto-detect column semantics ─────────────────────────────────────────────
function detectValueCol(records: NodeRecord[]): string | null {
  const candidates = ["deal_value","value","amount","price","revenue","arr","budget","salary","cost","total","fee","rate"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  // Fall back to first column that looks numeric
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

// ─── Stage classification (works for any object with status/stage) ────────────
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

function periodStart(p: Period): Date {
  const d = new Date();
  if (p === "today")   { d.setHours(0,0,0,0); return d; }
  if (p === "week")    { d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; }
  if (p === "month")   { d.setDate(1); d.setHours(0,0,0,0); return d; }
  if (p === "quarter") { d.setMonth(Math.floor(d.getMonth()/3)*3, 1); d.setHours(0,0,0,0); return d; }
  d.setMonth(0,1); d.setHours(0,0,0,0); return d;
}

function bucketLabel(date: Date, p: Period): string {
  if (p === "today")   return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (p === "week")    return date.toLocaleDateString([], { weekday: "short" });
  if (p === "month")   return date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (p === "quarter") return `${date.toLocaleDateString([], { month: "short" })} W${Math.ceil(date.getDate()/7)}`;
  return date.toLocaleDateString([], { month: "short" });
}

function buildTrend(records: NodeRecord[], valueCol: string | null, stageCol: string | null, period: Period) {
  const start = periodStart(period);
  const buckets: Map<string, { revenue: number; count: number }> = new Map();
  for (const r of records) {
    const raw = r.updated_at ?? r.created_at ?? (r.data as any).created_at ?? (r.data as any).updated_at;
    if (!raw) continue;
    const d = new Date(raw as string);
    if (d < start) continue;
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

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, trend }: {
  label: string; value: string; sub?: string; color: string; trend?: "up"|"down"|"neutral";
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border p-5 print:border-gray-200 ${color}`}>
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl print:hidden" style={{ background:"currentColor" }}/>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-current opacity-60">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white leading-none print:text-black">{value}</p>
      {sub && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-white/50 print:text-gray-500">
          {trend === "up"      && <TrendingUp  size={11} className="text-emerald-400"/>}
          {trend === "down"    && <TrendingDown size={11} className="text-red-400"/>}
          {trend === "neutral" && <Minus size={11}/>}
          {sub}
        </div>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1d24] px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-slate-300">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" && p.value > 100 ? fmtMoney(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

const STAGE_COLORS  = ["#6366f1","#8b5cf6","#a855f7","#d946ef","#ec4899","#f43f5e","#f97316","#eab308"];
const PERIOD_LABELS: Record<Period,string> = { today:"Today", week:"This Week", month:"This Month", quarter:"This Quarter", year:"This Year" };

// ─── Object picker dropdown ───────────────────────────────────────────────────
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
        <ChevronDown size={13} className="text-slate-500"/>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)}/>
          <div className="absolute left-0 top-10 z-20 min-w-[160px] overflow-hidden rounded-lg border border-white/[.08] bg-[#13151a] shadow-xl">
            {objects.map(o => (
              <button
                key={o.slug}
                onClick={() => { onChange(o.slug); setOpen(false); }}
                className={`flex w-full items-center px-3 py-2.5 text-sm transition-colors hover:bg-white/[.04] ${o.slug === value ? "text-red-400 font-medium" : "text-slate-300"}`}
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

// ─── Determine report vocabulary based on detected columns ────────────────────
function getReportVocab(valueCol: string | null, stageCol: string | null) {
  const hasValue = !!valueCol;
  const hasStage = !!stageCol;
  return {
    kpi1Label:   hasValue ? "Total Value"   : "Total Records",
    kpi2Label:   hasStage ? "In Progress"   : "This Period",
    kpi3Label:   hasStage ? "Completion Rate" : "Active",
    kpi4Label:   hasValue ? `Avg ${valueCol ?? "value"}` : "Avg per period",
    trendLabel:  hasValue ? "Value Trend"   : "Activity Trend",
    tableLabel:  hasValue ? `Top by ${valueCol ?? "value"}` : "All Records",
    stageLabel:  hasStage ? `By ${stageCol}` : "Distribution",
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function SalesReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>("month");

  const objectsQ = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string }>>("/objects"),
    staleTime: 60_000,
  });
  const objects = objectsQ.data ?? [];

  // Object slug: prefer URL param → first sales-like object → first object
  const urlSlug = searchParams.get("object");
  const defaultSlug = useMemo(() => {
    if (urlSlug && objects.find(o => o.slug === urlSlug)) return urlSlug;
    return objects.find(o => ["deals","deal","sales","opportunities","pipeline"].includes(o.slug))?.slug
      ?? objects[0]?.slug
      ?? "deals";
  }, [objects, urlSlug]);

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const activeSlug = selectedSlug || defaultSlug;

  const handleObjectChange = (slug: string) => {
    setSelectedSlug(slug);
    setSearchParams({ object: slug });
  };

  const recordsQ = useQuery({
    queryKey: ["records", activeSlug],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(activeSlug)}&limit=500`),
    staleTime: 30_000,
    enabled: !!activeSlug,
  });

  const records  = recordsQ.data ?? [];
  const valueCol = useMemo(() => detectValueCol(records), [records]);
  const stageCol = useMemo(() => detectStageCol(records), [records]);
  const nameCol  = useMemo(() => detectNameCol(records),  [records]);
  const vocab    = useMemo(() => getReportVocab(valueCol, stageCol), [valueCol, stageCol]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = records.filter(r => {
      const raw = r.updated_at ?? r.created_at ?? (r.data as any).updated_at ?? (r.data as any).created_at;
      return raw ? new Date(raw as string) >= start : true;
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
  }, [records, period, valueCol, stageCol]);

  // ── Stage breakdown ────────────────────────────────────────────────────────
  const stageData = useMemo(() => {
    if (!stageCol) return [];
    const counts: Record<string, { count: number; value: number }> = {};
    for (const r of records) {
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
  }, [records, stageCol, valueCol]);

  const trendData = useMemo(() => buildTrend(records, valueCol, stageCol, period), [records, valueCol, stageCol, period]);

  const topRecords = useMemo(() => {
    if (!valueCol) return records.slice(0, 8);
    return [...records]
      .filter(r => r.data[valueCol] != null)
      .sort((a,b) => Number(b.data[valueCol] ?? 0) - Number(a.data[valueCol] ?? 0))
      .slice(0, 8);
  }, [records, valueCol]);

  const selectedObj = objects.find(o => o.slug === activeSlug);
  const objLabel    = selectedObj?.name_plural ?? activeSlug;
  const now         = new Date().toLocaleDateString([], { year:"numeric", month:"long", day:"numeric" });
  const hasValue    = !!valueCol;
  const hasStage    = !!stageCol;

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
        <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
          <Link to="/reports" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
            <ArrowLeft size={14}/> Reports
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-white">Live Report</h1>
              {objects.length > 0 && (
                <ObjectPicker objects={objects} value={activeSlug} onChange={handleObjectChange}/>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {records.length} records
              {valueCol && ` · value from "${valueCol}"`}
              {stageCol && ` · status from "${stageCol}"`}
            </p>
          </div>

          {/* Period picker */}
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[.03] p-1">
            {(["today","week","month","quarter","year"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${period===p ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors">
            <Printer size={13}/> Print
          </button>
        </div>

        {/* Print period */}
        <div className="hidden print:block mb-6">
          <p className="text-sm font-semibold text-gray-700">{objLabel} — {PERIOD_LABELS[period]}</p>
        </div>

        {recordsQ.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-500/30 border-t-red-500"/>
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-slate-400 text-sm">No {objLabel} records found.</p>
            <Link to={`/objects/${activeSlug}`} className="text-sm text-red-400 hover:text-red-300">
              Go to {objLabel} →
            </Link>
            {objects.length > 1 && (
              <p className="text-xs text-slate-600">Or pick a different object type above</p>
            )}
          </div>
        ) : (
          <>
            {/* KPI Grid */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
              <KpiCard
                label={hasValue ? (hasStage ? "Total Won Value" : "Total Value") : "Total Records"}
                value={hasValue ? fmtMoney(stats.wonValue || stats.totalValue) : fmtNum(stats.totalCount)}
                sub={hasStage ? `${stats.wonCount} completed` : `${stats.totalCount} total`}
                color="border-emerald-500/20 bg-emerald-500/[.06] text-emerald-400"
                trend="up"
              />
              <KpiCard
                label={hasStage ? "In Progress" : "This Period"}
                value={hasValue ? fmtMoney(stats.openValue) : fmtNum(stats.openCount || stats.totalCount)}
                sub={hasStage ? `${stats.openCount} open` : "active records"}
                color="border-blue-500/20 bg-blue-500/[.06] text-blue-400"
                trend="neutral"
              />
              <KpiCard
                label={hasStage ? "Completion Rate" : "Total This Period"}
                value={hasStage ? `${stats.completionRate}%` : fmtNum(stats.totalCount)}
                sub={hasStage ? "completed vs. all closed" : `across ${PERIOD_LABELS[period].toLowerCase()}`}
                color="border-violet-500/20 bg-violet-500/[.06] text-violet-400"
                trend={hasStage ? (stats.completionRate >= 50 ? "up" : "down") : "neutral"}
              />
              <KpiCard
                label={hasValue ? `Avg ${valueCol}` : "Avg per bucket"}
                value={hasValue ? fmtMoney(stats.avgVal) : fmtNum(stats.totalCount ? Math.round(stats.totalCount / Math.max(trendData.length, 1)) : 0)}
                sub="per record"
                color="border-amber-500/20 bg-amber-500/[.06] text-amber-400"
              />
              <KpiCard
                label="Total Records"
                value={fmtNum(stats.totalCount)}
                sub="in this period"
                color="border-rose-500/20 bg-rose-500/[.06] text-rose-400"
              />
              <KpiCard
                label={hasStage ? "Open / Active" : "All Time"}
                value={fmtNum(hasStage ? stats.openCount : records.length)}
                sub={hasStage ? "in pipeline" : "records total"}
                color="border-cyan-500/20 bg-cyan-500/[.06] text-cyan-400"
              />
            </div>

            {/* Charts */}
            <div className="mb-8 grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-4">
              {/* Trend over time */}
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">{vocab.trendLabel}</h3>
                {trendData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-slate-600">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trendData}>
                      <CartesianGrid stroke="#22262d" strokeDasharray="3 3"/>
                      <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }}/>
                      <YAxis stroke="#475569" tick={{ fontSize: 10 }} tickFormatter={v => hasValue ? fmtMoney(v) : String(v)}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      {hasValue && <Line type="monotone" dataKey="revenue" name={valueCol ?? "value"} stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r:4, fill:"#10b981" }}/>}
                      <Line type="monotone" dataKey="count" name="Records" stroke="#6366f1" strokeWidth={hasValue ? 1.5 : 2.5} dot={false} strokeDasharray={hasValue ? "4 4" : undefined}/>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Stage / status breakdown */}
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">{vocab.stageLabel}</h3>
                {stageData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-slate-600">
                    {hasStage ? "No stage data" : `No "${stageCol ?? "status"}" column detected`}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stageData} layout="vertical">
                      <CartesianGrid stroke="#22262d" horizontal={false}/>
                      <XAxis type="number" stroke="#475569" tick={{ fontSize:10 }}/>
                      <YAxis dataKey="label" type="category" width={90} stroke="#475569" tick={{ fontSize:10 }}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Bar dataKey="count" name="Records" radius={[0,4,4,0]}>
                        {stageData.map((_,i) => <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Count over time */}
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Activity Over Time</h3>
                {trendData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-slate-600">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData}>
                      <CartesianGrid stroke="#22262d" strokeDasharray="3 3"/>
                      <XAxis dataKey="label" stroke="#475569" tick={{ fontSize:10 }}/>
                      <YAxis stroke="#475569" tick={{ fontSize:10 }}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Bar dataKey="count" name="Records" fill="#6366f1" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Value funnel — only if we have both value and stage */}
              {hasValue && hasStage && (
                <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">Value by {stageCol}</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <FunnelChart>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Funnel
                        dataKey="value"
                        data={stageData.map((d,i) => ({ ...d, fill: STAGE_COLORS[i % STAGE_COLORS.length] }))}
                        isAnimationActive
                      >
                        <LabelList position="center" dataKey="label" style={{ fill:"#fff", fontSize:11 }}/>
                      </Funnel>
                    </FunnelChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Value only — bar chart when no stage */}
              {hasValue && !hasStage && (
                <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">{valueCol} Distribution</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData}>
                      <CartesianGrid stroke="#22262d" strokeDasharray="3 3"/>
                      <XAxis dataKey="label" stroke="#475569" tick={{ fontSize:10 }}/>
                      <YAxis stroke="#475569" tick={{ fontSize:10 }} tickFormatter={v => fmtMoney(v)}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Bar dataKey="revenue" name={valueCol ?? "value"} fill="#10b981" radius={[4,4,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Top Records Table */}
            <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
              <h3 className="mb-4 text-sm font-semibold print:text-black">{vocab.tableLabel}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[.06] print:border-gray-200">
                    <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-gray-500">Name</th>
                    {hasStage && <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-gray-500">{stageCol}</th>}
                    {hasValue && <th className="pb-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-gray-500">{valueCol}</th>}
                  </tr>
                </thead>
                <tbody>
                  {topRecords.map((r,i) => {
                    const stage = hasStage ? String(r.data[stageCol!] ?? "—") : "";
                    const val   = hasValue ? Number(r.data[valueCol!] ?? 0) : 0;
                    const won   = hasStage && isWon(stage);
                    const lost  = hasStage && isLost(stage);
                    return (
                      <tr key={r.id} className={`border-b border-white/[.03] print:border-gray-100 ${i%2===0?"":"bg-white/[.01] print:bg-gray-50"}`}>
                        <td className="py-2.5 pr-4">
                          <span className="font-medium text-white print:text-black">{String(r.data[nameCol] ?? "—")}</span>
                        </td>
                        {hasStage && (
                          <td className="py-2.5 pr-4">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${won ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : lost ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"} print:bg-transparent print:text-gray-600 print:border-gray-300`}>
                              {stage}
                            </span>
                          </td>
                        )}
                        {hasValue && (
                          <td className="py-2.5 text-right font-mono font-semibold text-white print:text-black">
                            {fmtMoney(isNaN(val) ? 0 : val)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {hasValue && (
                  <tfoot>
                    <tr className="border-t border-white/10 print:border-gray-300">
                      <td colSpan={hasStage ? 2 : 1} className="pt-3 text-xs text-slate-500 print:text-gray-500">
                        Total (top {topRecords.length})
                      </td>
                      <td className="pt-3 text-right font-mono font-semibold text-white print:text-black">
                        {fmtMoney(topRecords.reduce((s,r) => s + (isNaN(Number(r.data[valueCol!]??0)) ? 0 : Number(r.data[valueCol!]??0)), 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {/* Print footer */}
      <div className="hidden print:flex mt-8 px-8 pb-6 border-t border-gray-200 pt-4 text-xs text-gray-400 justify-between">
        <span>Mondaily — Live Report ({objLabel})</span>
        <span>{now}</span>
      </div>
    </div>
  );
}
