import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * KPITile + KPIGrid — THE stat tile, formalizing the `.telemetry-strip` cell that Finance pages
 * hand-roll today (label row → mono tabular value → quiet context line). One component so a KPI
 * on Reports, Finance, Home, and Team Oversight is the same object, and so accent/delta rendering
 * can't drift. The value is code-computed by the caller — this renders, it never derives.
 */
export function KPIGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`telemetry-strip ${className}`}>{children}</div>;
}

export function KPITile({ icon: Icon, label, value, sub, accent, delta, iconColor, valueColor }: {
  icon?: LucideIcon;
  label: string;
  /** Pre-formatted by the caller (currency/percent already applied) — honesty lives upstream. */
  value: ReactNode;
  /** One quiet context line: scope, as-of, caveat ("unpaid · as of today"). */
  sub?: ReactNode;
  /** Color the VALUE with the section accent — one per grid at most, for the headline stat. */
  accent?: boolean;
  /** A DeltaPill or similar, rendered beside the value. */
  delta?: ReactNode;
  iconColor?: string;
  /** Status-toned value (e.g. warn amber for pending, ok green for approved). Overrides accent. */
  valueColor?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        {Icon && <Icon size={12} style={{ color: iconColor ?? "var(--text-muted)" }} />}
        <span className="text-label" style={{ color: "var(--text-muted)" }}>{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-stat font-semibold tabular-nums" style={{ color: valueColor ?? (accent ? "var(--section-accent)" : "var(--text-primary)") }}>{value}</span>
        {delta}
      </div>
      {sub && <div className="mt-0.5 text-caption" style={{ color: "var(--text-faint)" }}>{sub}</div>}
    </div>
  );
}
