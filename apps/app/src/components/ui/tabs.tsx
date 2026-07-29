import type { LucideIcon } from "lucide-react";

/**
 * THE tab bar. One implementation, so tab chrome can't drift per page.
 *
 * Every tab bar in the app was hand-rolled, and the count-at-zero policy contradicted itself three
 * ways: decisions/approvals showed counts at 0, calls/tasks/messages hid them, emails/dashboard-view
 * had none. Hiding a zero makes the chrome REFLOW as data arrives and removes the most useful signal
 * a tab carries — "there is nothing here" is an answer, not an absence.
 *
 * So: when a count is provided it is ALWAYS rendered, including 0. Pass `count: undefined` (or omit
 * it) for a tab whose count isn't known — that renders no badge at all, which is honestly different
 * from a known zero.
 */
export interface TabItem {
  /** Stable key AND the value reported to onChange. */
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Rendered whenever it is a number — including 0. Omit when the count is genuinely unknown. */
  count?: number;
}

export function CountBadge({ value }: { value: number }) {
  return (
    <span
      className="ml-1.5 inline-flex min-w-[16px] items-center justify-center rounded-sm px-1 text-[10px] tabular-nums text-[var(--text-secondary)]"
      // Muted at zero so a populated tab still reads first, without the badge disappearing.
      style={{ background: "var(--surface-hover)", opacity: value === 0 ? 0.55 : 1 }}
    >
      {value}
    </span>
  );
}

export function Tabs({
  items,
  active,
  onChange,
  className = "",
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-[var(--border-soft)] ${className}`}
    >
      {items.map((t) => {
        const Icon = t.icon;
        const selected = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.id)}
            className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-body transition-colors focus-visible:ring-2 focus-visible:ring-[var(--section-accent)] ${
              selected
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {Icon && <Icon size={13} className="shrink-0" />}
            {t.label}
            {typeof t.count === "number" && <CountBadge value={t.count} />}
            {selected && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ background: "var(--section-accent)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
