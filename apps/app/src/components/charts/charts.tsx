/**
 * Premium, dependency-free SVG chart primitives for the Reports system. Every chart renders ONLY
 * the real data points it's given (no synthetic/placeholder series) and themes off the CSS vars, so
 * it matches every workspace theme. Responsive via viewBox; the container controls the height.
 */
import { useState } from "react";

export interface Point { label: string; value: number; previous?: number }

const ACCENT = "var(--section-accent)";
const GRID = "var(--border-soft)";
const TEXT_FAINT = "var(--text-faint)";
const fmt = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};
// "Nice" axis ceiling so gridlines land on round numbers.
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function EmptyChart({ msg = "No data for this range yet." }: { msg?: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center text-[12.5px]" style={{ color: TEXT_FAINT }}>{msg}</div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
export function BarChart({ data, height = 300 }: { data: Point[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <EmptyChart />;
  const W = 800, H = 300, padL = 44, padB = 34, padT = 12, padR = 12;
  const max = niceMax(Math.max(...data.map(d => d.value), 1));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const bw = plotW / data.length;
  const barW = Math.min(bw * 0.62, 54);
  const ticks = 4;
  return (
    <div style={{ height }} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const y = padT + (plotH * i) / ticks;
          const v = max - (max * i) / ticks;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth={1} strokeDasharray={i === ticks ? "0" : "3 4"} opacity={0.7} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={12} fill={TEXT_FAINT}>{fmt(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = padL + i * bw + (bw - barW) / 2;
          const h = (d.value / max) * plotH;
          const y = padT + plotH - h;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={y} width={barW} height={Math.max(h, 0)} rx={3} fill={ACCENT} opacity={hover === null || hover === i ? 1 : 0.45} />
              {hover === i && <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--text-primary)">{fmt(d.value)}</text>}
              {(data.length <= 12 || i % Math.ceil(data.length / 12) === 0) && (
                <text x={x + barW / 2} y={H - padB + 18} textAnchor="middle" fontSize={11.5} fill={TEXT_FAINT}>{d.label.length > 10 ? d.label.slice(0, 9) + "…" : d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Line / area chart ───────────────────────────────────────────────────────
export function LineChart({ data, height = 300, forecastFrom }: { data: Point[]; height?: number; forecastFrom?: number }) {
  if (!data.length) return <EmptyChart />;
  const W = 800, H = 300, padL = 44, padB = 34, padT = 14, padR = 14;
  const max = niceMax(Math.max(...data.map(d => d.value), 1));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xy = data.map((d, i) => {
    const x = padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = padT + plotH - (d.value / max) * plotH;
    return { x, y, d };
  });
  const linePath = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xy[xy.length - 1]!.x.toFixed(1)} ${padT + plotH} L${xy[0]!.x.toFixed(1)} ${padT + plotH} Z`;
  const ticks = 4;
  const splitX = forecastFrom != null && forecastFrom < data.length ? xy[forecastFrom]?.x : undefined;
  return (
    <div style={{ height }} className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const y = padT + (plotH * i) / ticks;
          const v = max - (max * i) / ticks;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={GRID} strokeWidth={1} strokeDasharray={i === ticks ? "0" : "3 4"} opacity={0.7} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize={12} fill={TEXT_FAINT}>{fmt(v)}</text>
            </g>
          );
        })}
        {/* forecast band shading */}
        {splitX != null && <rect x={splitX} y={padT} width={W - padR - splitX} height={plotH} fill={ACCENT} opacity={0.05} />}
        <path d={areaPath} fill="url(#areaGrad)" />
        <path d={linePath} fill="none" stroke={ACCENT} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        {xy.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={data.length <= 24 ? 3 : 0} fill="var(--surface-card)" stroke={ACCENT} strokeWidth={2} />
            {(data.length <= 10 || i % Math.ceil(data.length / 10) === 0) && (
              <text x={p.x} y={H - padB + 18} textAnchor="middle" fontSize={11.5} fill={TEXT_FAINT}>{p.d.label.length > 10 ? p.d.label.slice(0, 9) + "…" : p.d.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Donut chart (categorical share) ─────────────────────────────────────────
const DONUT_COLORS = ["var(--section-accent)", "#6f9c97", "#b08968", "#8b7fb0", "#7fa37f", "#c2a06b", "#b08a90", "#7f93b0"];
export function DonutChart({ data, height = 300 }: { data: Point[]; height?: number }) {
  if (!data.length) return <EmptyChart />;
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const R = 70, r = 44, cx = 90, cy = 90;
  let angle = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const frac = Math.max(0, d.value) / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
    const path = `M${p(R, a0)} A${R} ${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
    return { path, color: DONUT_COLORS[i % DONUT_COLORS.length], d, frac };
  });
  return (
    <div style={{ height }} className="flex w-full items-center gap-6">
      <svg viewBox="0 0 180 180" className="h-full max-h-[240px]" style={{ aspectRatio: "1" }}>
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} />)}
        <text x={90} y={86} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--text-primary)">{fmt(total)}</text>
        <text x={90} y={104} textAnchor="middle" fontSize={11} fill={TEXT_FAINT}>total</text>
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {arcs.slice(0, 8).map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-secondary)" }}>{a.d.label}</span>
            <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>{fmt(a.d.value)}</span>
            <span className="w-10 text-right tabular-nums" style={{ color: TEXT_FAINT }}>{Math.round(a.frac * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Funnel chart (stages + drop-off) ────────────────────────────────────────
export function FunnelChart({ data, height = 300 }: { data: (Point & { dropoff?: number })[]; height?: number }) {
  if (!data.length) return <EmptyChart />;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ minHeight: Math.min(height, 60 + data.length * 46) }} className="w-full space-y-2 py-1">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-right text-[12px]" style={{ color: "var(--text-secondary)" }}>{d.label}</div>
            <div className="relative h-9 flex-1 overflow-hidden rounded-sm" style={{ background: "var(--surface-hover)" }}>
              <div className="flex h-full items-center rounded-sm px-2.5 text-[12px] font-semibold text-black transition-[width]" style={{ width: `${Math.max(pct, 6)}%`, background: ACCENT }}>
                {fmt(d.value)}
              </div>
            </div>
            <div className="w-14 shrink-0 text-[11px] tabular-nums" style={{ color: d.dropoff && d.dropoff > 0 ? "#dc7676" : TEXT_FAINT }}>
              {i > 0 && d.dropoff != null ? `−${d.dropoff}%` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Auto-pick the right chart for the data shape + requested chart type. */
export function AutoChart({ chartType, data, height, forecastFrom }: {
  chartType?: string; data: (Point & { dropoff?: number })[]; height?: number; forecastFrom?: number;
}) {
  if (!data?.length) return <EmptyChart />;
  switch (chartType) {
    case "bar": return <BarChart data={data} height={height} />;
    case "donut": return <DonutChart data={data} height={height} />;
    case "funnel": return <FunnelChart data={data} height={height} />;
    default: return <LineChart data={data} height={height} forecastFrom={forecastFrom} />;
  }
}
