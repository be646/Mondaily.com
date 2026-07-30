/**
 * SegmentedControl — the ONE pill-track segmented control.
 *
 * Distinct from ui/tabs on purpose: Tabs are NAVIGATION (underline, page sections); this is a
 * FILTER/MODE control (pill track, active segment lifted onto --surface-card). The pattern existed
 * only inside FinanceListToolbar; extracting it gives the calendar view-switch and the period bars
 * the same control instead of a dropdown here and a button wall there.
 *
 * Counts follow the tabs contract: rendered whenever a number is given — INCLUDING zero, because
 * on a filter the zero is the useful fact ("Rejected 0" answers the question without a click) —
 * and omitted only when genuinely unknown.
 */
export interface Segment { key: string; label: string; count?: number }

export function SegmentedControl({ segments, active, onChange, className = "" }: {
  segments: Segment[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  // HAIRLINES, NOT BOXES (measured, not guessed — 2026-07-30 against a reference dashboard):
  // the modern segmented idiom has NO track border and NO lifted card. Segments are bare text
  // buttons; the active one gets a faint ink wash (~4-5%) with a small radius. The boxy pill
  // track this replaced was the "filters look like boxes" complaint. Mondaily tokens throughout.
  return (
    <div
      role="radiogroup"
      className={`inline-flex flex-wrap items-center gap-0.5 ${className}`}
    >
      {segments.map(s => {
        const isActive = active === s.key;
        return (
          <button
            key={s.key}
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(s.key)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors"
            style={isActive
              ? { background: "color-mix(in srgb, var(--text-primary) 5%, transparent)", color: "var(--text-primary)" }
              : { color: "var(--text-muted)" }}
          >
            {s.label}
            {typeof s.count === "number" && (
              <span className="tabular-nums text-[10px]" style={{ color: isActive ? "var(--text-muted)" : "var(--text-faint)" }}>
                {s.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
