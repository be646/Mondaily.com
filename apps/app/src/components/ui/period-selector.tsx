import { PERIODS, type Period, type CustomRange } from "../../lib/period";

/**
 * PeriodSelector — the single shared reporting-period control (Today/Week/Month/Quarter/Year/All
 * + optional Custom range). Same segmented look as the finance toolbar so every KPI surface reads
 * consistently. The active segment sits on --surface-card with a hairline + soft shadow.
 *
 * Custom is opt-in: pass `custom` + `onCustom` to enable a "Custom" chip that reveals two date
 * inputs. Without them the chip is hidden.
 */
export function PeriodSelector({ value, onChange, custom, onCustom, className = "" }: {
  value: Period;
  onChange: (p: Period) => void;
  custom?: CustomRange;
  onCustom?: (range: CustomRange) => void;
  className?: string;
}) {
  const chips = [...PERIODS, ...(onCustom ? [{ key: "custom" as Period, label: "Custom" }] : [])];
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {/* HAIRLINES, NOT BOXES — same idiom as SegmentedControl (measured 2026-07-30): no track
          border, no lifted card, no shadow. Active chip = faint ink wash + small radius. */}
      <div className="inline-flex flex-wrap items-center gap-0.5">
        {chips.map(p => {
          const active = value === p.key;
          return (
            <button key={p.key} onClick={() => onChange(p.key)}
              className="rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
              style={active
                ? { background: "color-mix(in srgb, var(--text-primary) 5%, transparent)", color: "var(--text-primary)" }
                : { color: "var(--text-muted)" }}>
              {p.label}
            </button>
          );
        })}
      </div>
      {value === "custom" && onCustom && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={custom?.start ?? ""} onChange={e => onCustom({ ...custom, start: e.target.value })}
            aria-label="From date"
            className="key-input h-8 px-2 text-[11.5px] [color-scheme:dark]"/>
          <span className="text-[11px] text-[var(--text-secondary)]">→</span>
          <input type="date" value={custom?.end ?? ""} onChange={e => onCustom({ ...custom, end: e.target.value })}
            aria-label="To date"
            className="key-input h-8 px-2 text-[11.5px] [color-scheme:dark]"/>
        </div>
      )}
    </div>
  );
}
