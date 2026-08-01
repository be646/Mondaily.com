import { Activity } from "lucide-react";

/** Shape written onto a deal node's data.pipeline_health by the Forecast agent (runPipelineHealth). */
export interface PipelineHealth {
  band?: "healthy" | "watch" | "at_risk";
  momentum?: number;
  momentum_source?: "lead_score" | "default";
  value?: number | null;
  weighted_value?: number | null;
  days_idle?: number;
  updated_at?: string;
}

const BANDS = {
  healthy: { label: "Healthy", text: "text-status-ok", bg: "bg-status-ok/10 border-status-ok/20", bar: "bg-status-ok" },
  watch:   { label: "Watch",   text: "text-status-warn", bg: "bg-status-warn/10 border-status-warn/20", bar: "bg-status-warn" },
  at_risk: { label: "At risk", text: "text-status-error", bg: "bg-status-error/10 border-status-error/20", bar: "bg-status-error" },
} as const;

function money(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * Forecast health for a deal — the Forecast agent's synthesis of momentum (lead score) + value into a
 * risk band, a risk-adjusted (weighted) forecast value, and idle days. Honest: renders nothing until
 * the agent has run for this record. Companion to the AI Lead Score.
 */
export function PipelineHealthBadge({ health, compact = false }: { health?: PipelineHealth | null; compact?: boolean }) {
  if (!health || !health.band) return null;
  const b = BANDS[health.band] ?? BANDS.watch;
  const momentum = typeof health.momentum === "number" ? health.momentum : null;
  const value = money(health.value);
  const weighted = money(health.weighted_value);

  // Compact: ONE line for table cells — the full card blew every row up to card height and
  // wrecked the sheet. Band pill + momentum; the record page keeps the full card.
  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-sm border ${b.bg} px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap`}
        title={`Forecast health: ${b.label}${momentum != null ? ` · momentum ${momentum}/100` : ""}${health.days_idle != null ? ` · idle ${health.days_idle}d` : ""}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${b.bar}`}/>
        <span className={b.text}>{b.label}</span>
        {momentum != null && <span className="text-[var(--text-muted)]">{momentum}</span>}
      </span>
    );
  }

  return (
    <div className={`rounded-sm border ${b.bg} px-4 py-3`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity size={13} className={b.text} />
          <span className="text-xs font-semibold text-[var(--text-primary)]">Forecast health</span>
        </div>
        <span className={`text-[11px] font-bold uppercase tracking-wide ${b.text}`}>{b.label}</span>
      </div>

      {momentum != null && (
        <>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
            <div className={`h-full rounded-full transition-all ${b.bar}`} style={{ width: `${Math.max(0, Math.min(100, momentum))}%` }} />
          </div>
          <p className={`mt-1.5 text-[10px] font-medium ${b.text}`}>
            Momentum {momentum}/100{health.momentum_source === "default" ? " (not yet scored)" : ""}
          </p>
        </>
      )}

      <div className="mt-3 space-y-1 border-t pt-2.5" style={{ borderColor: "var(--border-soft)" }}>
        {value && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span style={{ color: "var(--text-muted)" }}>Deal value</span>
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{value}</span>
          </div>
        )}
        {weighted && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span style={{ color: "var(--text-muted)" }}>Risk-adjusted</span>
            <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{weighted}</span>
          </div>
        )}
        {typeof health.days_idle === "number" && (
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span style={{ color: "var(--text-muted)" }}>Idle</span>
            <span className="inline-flex items-center gap-1 font-medium" style={{ color: "var(--text-secondary)" }}>
              {health.days_idle === 0 ? "today" : `${health.days_idle}d`}
              {health.days_idle > 30 && <span className="text-status-error">↓</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
