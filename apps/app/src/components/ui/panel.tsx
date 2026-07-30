import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Panel — THE hairline content card: header row (icon + title + optional count/meta) over a body.
 *
 * Extracted from the best-measured instance in the app (Discovery's Watched-searches panel) so
 * every boxed section shares one recipe instead of each page hand-rolling its own border/header
 * combination — the "each page a different app" complaint applied to content, not just chrome.
 * Density is fixed on purpose: px-3.5, 12px semibold title, hairline divider. Content stays free.
 */
export function Panel({ icon: Icon, title, count, meta, actions, children, className = "" }: {
  icon?: LucideIcon;
  title: string;
  /** Shown dim beside the title whenever known — including 0 (the tabs/segment count contract). */
  count?: number;
  /** Quiet right-aligned caption ("re-run daily · alerts on new results"). */
  meta?: ReactNode;
  /** Right-aligned controls; rendered after meta. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-sm border ${className}`} style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      <div className="flex items-center gap-1.5 border-b px-3.5 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
        {Icon && <Icon size={13} style={{ color: "var(--section-accent)" }} />}
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{title}</span>
        {typeof count === "number" && <span className="text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{count}</span>}
        {meta && <span className="ml-auto text-[10.5px]" style={{ color: "var(--text-faint)" }}>{meta}</span>}
        {actions && <span className={`flex items-center gap-1.5 ${meta ? "" : "ml-auto"}`}>{actions}</span>}
      </div>
      {children}
    </div>
  );
}
