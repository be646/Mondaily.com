import { PERIODS, type Period } from "../../lib/period";

/**
 * PeriodSelector — the single shared reporting-period control (Today/Week/Month/Quarter/Year/All).
 * Same segmented look as the finance toolbar so every KPI surface reads consistently. The active
 * segment sits on --surface-card with a hairline + soft shadow so the selection is clearly visible.
 */
export function PeriodSelector({ value, onChange, className = "" }: {
  value: Period;
  onChange: (p: Period) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5 ${className}`}
      style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)" }}>
      {PERIODS.map(p => {
        const active = value === p.key;
        return (
          <button key={p.key} onClick={() => onChange(p.key)}
            className="rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
            style={active
              ? { background: "var(--surface-card)", color: "var(--text-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.18)" }
              : { color: "var(--text-muted)" }}>
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
