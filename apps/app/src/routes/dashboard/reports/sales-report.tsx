import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, FunnelChart, Funnel, LabelList,
} from "recharts";
import { useState, useMemo } from "react";
import { Printer, TrendingUp, TrendingDown, Minus, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { apiClient } from "../../../lib/api-client";

interface NodeRecord { id: string; object_type: string; data: Record<string, unknown>; created_at?: string; updated_at?: string }

type Period = "today" | "week" | "month" | "quarter" | "year";

// ─── Auto-detect column names ─────────────────────────────────────────────────
function detectValueCol(records: NodeRecord[]): string | null {
  const candidates = ["deal_value","value","amount","price","revenue","arr","budget","salary"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  return keys.find(k => records.some(r => r.data[k] != null && !isNaN(Number(r.data[k])))) ?? null;
}
function detectStageCol(records: NodeRecord[]): string | null {
  const candidates = ["deal_stage","stage","status","phase","state","pipeline_stage"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  return null;
}
function detectNameCol(records: NodeRecord[]): string {
  const candidates = ["name","title","deal_name","company","contact"];
  const keys = Array.from(new Set(records.flatMap(r => Object.keys(r.data))));
  for (const c of candidates) if (keys.includes(c)) return c;
  return keys[0] ?? "name";
}

const WON_KEYWORDS = ["won","closed won","win","closed","completed","converted","success"];
const LOST_KEYWORDS = ["lost","closed lost","rejected","declined","dead","churned"];
function isWon(stage: string) { return WON_KEYWORDS.some(k => stage.toLowerCase().includes(k)); }
function isLost(stage: string) { return LOST_KEYWORDS.some(k => stage.toLowerCase().includes(k)); }
function isOpen(stage: string) { return !isWon(stage) && !isLost(stage); }

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
function fmtNum(n: number) {
  return n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);
}

function periodStart(p: Period): Date {
  const d = new Date();
  if (p === "today") { d.setHours(0, 0, 0, 0); return d; }
  if (p === "week") { const day = d.getDay(); d.setDate(d.getDate() - day); d.setHours(0,0,0,0); return d; }
  if (p === "month") { d.setDate(1); d.setHours(0,0,0,0); return d; }
  if (p === "quarter") { const q = Math.floor(d.getMonth() / 3); d.setMonth(q * 3, 1); d.setHours(0,0,0,0); return d; }
  d.setMonth(0, 1); d.setHours(0,0,0,0); return d;
}

function bucketLabel(date: Date, p: Period): string {
  if (p === "today") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (p === "week") return date.toLocaleDateString([], { weekday: "short" });
  if (p === "month") return date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (p === "quarter") {
    const week = Math.ceil(date.getDate() / 7);
    return `${date.toLocaleDateString([], { month: "short" })} W${week}`;
  }
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
    const val = valueCol ? Number(r.data[valueCol] ?? 0) : 0;
    const label = bucketLabel(d, period);
    const existing = buckets.get(label) ?? { revenue: 0, count: 0 };
    if (!stageCol || isWon(stage)) {
      existing.revenue += isNaN(val) ? 0 : val;
      existing.count += 1;
    }
    buckets.set(label, existing);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, { revenue, count }]) => ({ label, revenue, count }));
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color, trend }: {
  label: string; value: string; sub?: string; color: string; trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border p-5 print:border-gray-200 ${color}`}>
      {/* Glow blob */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl print:hidden"
        style={{ background: "currentColor" }} />
      <p className="text-[11px] font-semibold uppercase tracking-widest text-current opacity-60">{label}</p>
      <p className="mt-2 text-3xl font-bold text-white leading-none print:text-black">{value}</p>
      {sub && (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-white/50 print:text-gray-500">
          {trend === "up" && <TrendingUp size={11} className="text-emerald-400"/>}
          {trend === "down" && <TrendingDown size={11} className="text-red-400"/>}
          {trend === "neutral" && <Minus size={11}/>}
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Custom tooltip ────────────────────────────────────────────────────────────
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

const STAGE_COLORS = ["#6366f1","#8b5cf6","#a855f7","#d946ef","#ec4899","#f43f5e"];
const PERIOD_LABELS: Record<Period, string> = { today: "Today", week: "This Week", month: "This Month", quarter: "This Quarter", year: "This Year" };

// ─── Main page ─────────────────────────────────────────────────────────────────
export function SalesReportPage() {
  const [period, setPeriod] = useState<Period>("month");

  // Fetch all deal records — uses same cache key as board/table
  const objectsQ = useQuery({
    queryKey: ["sidebar-objects"],
    queryFn: () => apiClient.get<Array<{ slug: string; name_plural: string }>>("/objects"),
    staleTime: 60_000,
  });

  // Try to find the deals object type slug
  const dealSlug = useMemo(() => {
    const objs = objectsQ.data ?? [];
    return objs.find(o => ["deals","deal","sales"].includes(o.slug))?.slug ?? "deals";
  }, [objectsQ.data]);

  const dealsQ = useQuery({
    queryKey: ["records", dealSlug],
    queryFn: () => apiClient.get<NodeRecord[]>(`/nodes?object_type=${encodeURIComponent(dealSlug)}&limit=500`),
    staleTime: 30_000,
  });

  const records = dealsQ.data ?? [];
  const valueCol = useMemo(() => detectValueCol(records), [records]);
  const stageCol = useMemo(() => detectStageCol(records), [records]);
  const nameCol = useMemo(() => detectNameCol(records), [records]);

  // ── Core stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = records.filter(r => {
      const raw = r.updated_at ?? r.created_at ?? (r.data as any).updated_at ?? (r.data as any).created_at;
      return raw ? new Date(raw as string) >= start : true;
    });

    const getVal = (r: NodeRecord) => {
      const v = valueCol ? r.data[valueCol] : undefined;
      const n = Number(v ?? 0);
      return isNaN(n) ? 0 : n;
    };
    const getStage = (r: NodeRecord) => stageCol ? String(r.data[stageCol] ?? "") : "";

    const wonDeals = inPeriod.filter(r => isWon(getStage(r)));
    const lostDeals = inPeriod.filter(r => isLost(getStage(r)));
    const openDeals = inPeriod.filter(r => isOpen(getStage(r)));

    const revenue = wonDeals.reduce((s, r) => s + getVal(r), 0);
    const pipeline = openDeals.reduce((s, r) => s + getVal(r), 0);
    const winRate = (wonDeals.length + lostDeals.length) > 0
      ? Math.round((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100) : 0;
    const avgDeal = wonDeals.length ? Math.round(revenue / wonDeals.length) : 0;

    return { revenue, pipeline, winRate, avgDeal, wonCount: wonDeals.length, openCount: openDeals.length, totalCount: inPeriod.length };
  }, [records, period, valueCol, stageCol]);

  // ── Stage breakdown ──────────────────────────────────────────────────────────
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
      .map(([label, { count, value }]) => ({ label, count, value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [records, stageCol, valueCol]);

  // ── Trend over time ──────────────────────────────────────────────────────────
  const trendData = useMemo(() => buildTrend(records, valueCol, stageCol, period), [records, valueCol, stageCol, period]);

  // ── Top deals ────────────────────────────────────────────────────────────────
  const topDeals = useMemo(() => {
    if (!valueCol) return [];
    return [...records]
      .filter(r => r.data[valueCol] != null)
      .sort((a, b) => Number(b.data[valueCol] ?? 0) - Number(a.data[valueCol] ?? 0))
      .slice(0, 8);
  }, [records, valueCol]);

  const now = new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-full bg-[#0d0f13] print:bg-white text-white print:text-black">
      {/* ── Print header (only visible when printing) ── */}
      <div className="hidden print:flex items-center justify-between px-8 py-6 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-bold text-black">Sales Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">{PERIOD_LABELS[period]} · Generated {now}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-black">Mondaily</p>
          <p className="text-xs text-gray-500">Business Intelligence</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 print:max-w-none print:px-8 print:py-6">
        {/* ── Screen header ── */}
        <div className="mb-6 flex flex-wrap items-center gap-4 print:hidden">
          <Link to="/reports" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-white transition-colors">
            <ArrowLeft size={14}/> Reports
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Sales Report</h1>
            <p className="text-xs text-slate-500 mt-0.5">Live data from your {dealSlug} records</p>
          </div>
          {/* Period picker */}
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[.03] p-1">
            {(["today","week","month","quarter","year"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${period === p ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors">
            <Printer size={13}/> Print
          </button>
        </div>

        {/* Print period label */}
        <div className="hidden print:block mb-6">
          <p className="text-sm font-semibold text-gray-700">{PERIOD_LABELS[period]}</p>
        </div>

        {dealsQ.isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-500/30 border-t-red-500"/>
          </div>
        ) : records.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <p className="text-slate-400">No {dealSlug} records found.</p>
            <Link to={`/objects/${dealSlug}`} className="text-sm text-red-400 hover:text-red-300">Go to {dealSlug} →</Link>
          </div>
        ) : (
          <>
            {/* ── KPI Grid ── */}
            <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-3">
              <KpiCard label="Revenue Won" value={fmtMoney(stats.revenue)} sub={`${stats.wonCount} deals closed`} color="border-emerald-500/20 bg-emerald-500/[.06] text-emerald-400" trend="up"/>
              <KpiCard label="Pipeline Value" value={fmtMoney(stats.pipeline)} sub={`${stats.openCount} open deals`} color="border-blue-500/20 bg-blue-500/[.06] text-blue-400" trend="neutral"/>
              <KpiCard label="Win Rate" value={`${stats.winRate}%`} sub="closed won vs lost" color="border-violet-500/20 bg-violet-500/[.06] text-violet-400" trend={stats.winRate >= 50 ? "up" : "down"}/>
              <KpiCard label="Avg Deal Size" value={fmtMoney(stats.avgDeal)} sub="per closed deal" color="border-amber-500/20 bg-amber-500/[.06] text-amber-400"/>
              <KpiCard label="Total Deals" value={fmtNum(stats.totalCount)} sub="in this period" color="border-rose-500/20 bg-rose-500/[.06] text-rose-400"/>
              <KpiCard label="Open Deals" value={fmtNum(stats.openCount)} sub="in pipeline" color="border-cyan-500/20 bg-cyan-500/[.06] text-cyan-400"/>
            </div>

            {/* ── Charts row ── */}
            <div className="mb-8 grid gap-6 lg:grid-cols-2 print:grid-cols-2 print:gap-4">
              {/* Revenue trend */}
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Revenue Trend</h3>
                {trendData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-slate-600">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trendData}>
                      <CartesianGrid stroke="#22262d" strokeDasharray="3 3"/>
                      <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }}/>
                      <YAxis stroke="#475569" tick={{ fontSize: 10 }} tickFormatter={v => fmtMoney(v)}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#10b981" }}/>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Deals by stage */}
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Pipeline by Stage</h3>
                {stageData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-slate-600">No stage data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stageData} layout="vertical">
                      <CartesianGrid stroke="#22262d" horizontal={false}/>
                      <XAxis type="number" stroke="#475569" tick={{ fontSize: 10 }}/>
                      <YAxis dataKey="label" type="category" width={90} stroke="#475569" tick={{ fontSize: 10 }}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Bar dataKey="count" name="Deals" radius={[0, 4, 4, 0]}>
                        {stageData.map((_, i) => <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Deal count trend */}
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Deals Closed Over Time</h3>
                {trendData.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-xs text-slate-600">No data for this period</div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData}>
                      <CartesianGrid stroke="#22262d" strokeDasharray="3 3"/>
                      <XAxis dataKey="label" stroke="#475569" tick={{ fontSize: 10 }}/>
                      <YAxis stroke="#475569" tick={{ fontSize: 10 }}/>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Bar dataKey="count" name="Deals" fill="#6366f1" radius={[4, 4, 0, 0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Pipeline value by stage */}
              {valueCol && (
                <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                  <h3 className="mb-4 text-sm font-semibold print:text-black">Value by Stage</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <FunnelChart>
                      <Tooltip content={<ChartTooltip/>}/>
                      <Funnel dataKey="value" data={stageData.map((d, i) => ({ ...d, fill: STAGE_COLORS[i % STAGE_COLORS.length] }))} isAnimationActive>
                        <LabelList position="center" dataKey="label" style={{ fill: "#fff", fontSize: 11 }}/>
                      </Funnel>
                    </FunnelChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* ── Top Deals Table ── */}
            {topDeals.length > 0 && (
              <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-5 print:border-gray-200 print:bg-white">
                <h3 className="mb-4 text-sm font-semibold print:text-black">Top Deals by Value</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[.06] print:border-gray-200">
                      <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-gray-500">Deal</th>
                      {stageCol && <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-gray-500">Stage</th>}
                      {valueCol && <th className="pb-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500 print:text-gray-500">Value</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {topDeals.map((r, i) => {
                      const stage = stageCol ? String(r.data[stageCol] ?? "—") : "";
                      const val = valueCol ? Number(r.data[valueCol] ?? 0) : 0;
                      const won = isWon(stage);
                      const lost = isLost(stage);
                      return (
                        <tr key={r.id} className={`border-b border-white/[.03] print:border-gray-100 ${i % 2 === 0 ? "" : "bg-white/[.01] print:bg-gray-50"}`}>
                          <td className="py-2.5 pr-4">
                            <span className="font-medium text-white print:text-black">{String(r.data[nameCol] ?? "—")}</span>
                          </td>
                          {stageCol && (
                            <td className="py-2.5 pr-4">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${won ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : lost ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"} print:bg-transparent print:text-gray-600 print:border-gray-300`}>
                                {stage}
                              </span>
                            </td>
                          )}
                          {valueCol && (
                            <td className="py-2.5 text-right font-mono font-semibold text-white print:text-black">
                              {fmtMoney(isNaN(val) ? 0 : val)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                  {valueCol && (
                    <tfoot>
                      <tr className="border-t border-white/10 print:border-gray-300">
                        <td colSpan={stageCol ? 2 : 1} className="pt-3 text-xs text-slate-500 print:text-gray-500">Total (top {topDeals.length})</td>
                        <td className="pt-3 text-right font-mono font-semibold text-white print:text-black">
                          {fmtMoney(topDeals.reduce((s, r) => s + (isNaN(Number(r.data[valueCol] ?? 0)) ? 0 : Number(r.data[valueCol] ?? 0)), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Print footer */}
      <div className="hidden print:block mt-8 px-8 pb-6 border-t border-gray-200 pt-4 text-xs text-gray-400 flex justify-between">
        <span>Mondaily — Sales Report</span>
        <span>{now}</span>
      </div>
    </div>
  );
}
