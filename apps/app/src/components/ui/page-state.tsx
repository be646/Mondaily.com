import { AlertTriangle, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoMark } from "@/components/logo";
import type { ReactNode } from "react";

/**
 * Console wireframe loader — a thin-bordered, zero-radius grid mesh for data-heavy panels
 * (objects, members). Renders a wireline placeholder while a query hydrates so a fast transition
 * never flashes an empty black viewport. JetBrains-Mono header row to match the data aesthetic.
 */
export function ConsoleSkeleton({ rows = 7, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden rounded-sm border font-mono" style={{ borderColor: "var(--border-soft)" }}>
      <div className="flex items-center gap-2 px-4 py-2.5 text-[9px] uppercase tracking-widest" style={{ borderBottom: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--accent) 40%, transparent)" }} />
        loading stream…
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid items-center gap-3 px-4 py-3" style={{ gridTemplateColumns: `1.6fr repeat(${Math.max(1, cols - 1)}, 1fr)`, borderTop: i > 0 ? "1px solid var(--border-soft)" : undefined }}>
          <div className="flex items-center gap-2.5">
            <div className="skeleton-shimmer h-6 w-6 shrink-0 rounded-sm" />
            <div className="skeleton-shimmer h-3 rounded-sm" style={{ width: `${44 + (i % 3) * 14}%` }} />
          </div>
          {Array.from({ length: Math.max(1, cols - 1) }).map((_, j) => (
            <div key={j} className="skeleton-shimmer h-3 rounded-sm" style={{ width: `${40 + ((i + j) % 4) * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({ rows = 6, label }: { rows?: number; label?: string }) {
  return (
    <div aria-label={label ?? "Loading"} role="status">
      {label && (
        <p className="mb-3 text-xs font-medium text-[#9ca3af] dark:text-stone-500">{label}</p>
      )}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="surface-card flex items-center gap-3 rounded-lg px-3.5 py-3"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="skeleton-shimmer h-8 w-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton-shimmer h-3 rounded" style={{ width: `${52 + (index % 3) * 12}%` }} />
              <div className="skeleton-shimmer h-2.5 rounded" style={{ width: `${28 + (index % 4) * 8}%` }} />
            </div>
            <div className="skeleton-shimmer hidden h-5 w-16 shrink-0 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card-grid skeleton — for dashboard/report cards rather than list rows. */
export function PageSkeletonCards({ count = 4, label }: { count?: number; label?: string }) {
  return (
    <div aria-label={label ?? "Loading"} role="status">
      {label && (
        <p className="mb-3 text-xs font-medium text-[#9ca3af] dark:text-stone-500">{label}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="surface-card rounded-xl p-4">
            <div className="skeleton-shimmer mb-3 h-4 w-2/3 rounded" />
            <div className="skeleton-shimmer mb-2 h-24 rounded-lg" />
            <div className="skeleton-shimmer h-3 w-1/3 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg px-6 text-center" style={{ border: "1px solid var(--border-soft)", background: "var(--surface-card)" }}>
      <AlertTriangle className="mb-3 text-stone-400" size={26} />
      <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Something went wrong</h2>
      <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>
        {error?.message ?? "An unexpected error occurred. Please try again."}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary mt-4 text-xs">
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  aiHint,
  action
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional AI-flavoured hint shown as a subtle secondary line — only pass when genuinely relevant, never fabricated. */
  aiHint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center" style={{ borderColor: "var(--border-strong)" }}>
      <Icon className="mb-3" size={28} style={{ color: "var(--text-faint)" }}/>
      <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{title}</h2>
      <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>{description}</p>
      {aiHint && (
        <p className="mt-2.5 flex items-center gap-1.5 max-w-sm text-xs text-stone-600 dark:text-stone-400">
          <LogoMark size={11} className="shrink-0"/>
          {aiHint}
        </p>
      )}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h1>
        {description ? <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
