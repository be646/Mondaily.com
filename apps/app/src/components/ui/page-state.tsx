import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { useEffect, useState, type ReactNode } from "react";

/**
 * DelayedLoading — wraps a skeleton and, after a reasonable delay, adds an honest "Still loading…"
 * line with an optional Retry. Prevents a slow/hung request from looking like a broken, blank
 * skeleton-only screen. Shows nothing extra on fast loads (the skeleton alone). No invented data.
 */
export function DelayedLoading({ children, delayMs = 8000, onRetry, label = "Still thinking…" }: { children: ReactNode; delayMs?: number; onRetry?: () => void; label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), delayMs); return () => clearTimeout(t); }, [delayMs]);
  return (
    <>
      {children}
      {slow && (
        <div className="mt-4 flex items-center justify-center gap-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={13} className="animate-spin" /> {label}
          {onRetry && (
            <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--surface-hover)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
              <RefreshCw size={11} /> Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Console wireframe loader — a thin-bordered, zero-radius grid mesh for data-heavy panels
 * (objects, members). Renders a wireline placeholder while a query hydrates so a fast transition
 * never flashes an empty black viewport. JetBrains-Mono header row to match the data aesthetic.
 */
/** RouteThinking — the branded page-transition loader (replaces a bare "Loading…"). The Mondaily mark
 *  pulses while the route module + its data come up, and an honest status line cycles through the real
 *  stages. Used as the router Suspense fallback. */
export function RouteThinking() {
  const stages = ["Thinking…", "Loading the workspace…", "Preparing the view…"];
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI(v => (v + 1) % stages.length), 1300); return () => clearInterval(t); }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3.5 py-24" role="status" aria-label="Loading">
      <span className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: "var(--section-accent-soft)" }} />
        <span className="absolute inset-0 rounded-full" style={{ background: "var(--section-accent-soft)" }} />
        <LogoMark size={20} className="relative animate-pulse" style={{ color: "var(--section-accent)" }} />
      </span>
      <span className="text-body font-medium tabular-nums" style={{ color: "var(--text-muted)" }}>{stages[i]}</span>
    </div>
  );
}

export function ConsoleSkeleton({ rows = 7, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" className="overflow-hidden rounded-sm border font-mono" style={{ borderColor: "var(--border-soft)" }}>
      <div className="flex items-center gap-2 px-4 py-2.5 text-caption uppercase tracking-widest" style={{ borderBottom: "1px solid var(--border-soft)", color: "var(--text-faint)" }}>
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
          <div key={index} className="surface-card rounded-sm p-4">
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

/** One guided next action inside an EmptyState — a REAL thing the user can do right now
 *  (create, connect, import, configure). Never a placeholder for data that doesn't exist. */
export interface EmptyStateStep {
  icon: LucideIcon;
  label: string;
  /** One line on what this unlocks — honest, concrete. */
  hint?: string;
  onClick?: () => void;
  /** Router path — rendered as a plain anchor-styled button by the caller when needed. */
  disabled?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  aiHint,
  action,
  steps,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional AI-flavoured hint shown as a subtle secondary line — only pass when genuinely relevant, never fabricated. */
  aiHint?: string;
  action?: ReactNode;
  /** Guided next actions — turns "nothing here" into "here's what to do next". Real actions only. */
  steps?: EmptyStateStep[];
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--border-strong)" }}>
      <Icon className="mb-3" size={28} style={{ color: "var(--text-faint)" }}/>
      <h2 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{title}</h2>
      <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--text-muted)" }}>{description}</p>
      {aiHint && (
        <p className="mt-2.5 flex items-center gap-1.5 max-w-sm text-xs text-stone-600 dark:text-stone-400">
          <LogoMark size={11} className="shrink-0"/>
          {aiHint}
        </p>
      )}
      {steps && steps.length > 0 && (
        <div className="mt-5 w-full max-w-md space-y-1.5 text-left">
          {steps.map((s, i) => (
            <button
              key={i}
              onClick={s.onClick}
              disabled={s.disabled || !s.onClick}
              className="flex w-full items-start gap-3 rounded-sm border px-3.5 py-2.5 text-left transition-colors enabled:hover:border-[var(--section-accent)] enabled:hover:bg-[var(--surface-hover)] disabled:cursor-default"
              style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}
            >
              <s.icon size={15} className="mt-0.5 shrink-0" style={{ color: s.disabled ? "var(--text-faint)" : "var(--section-accent)" }} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium" style={{ color: s.disabled ? "var(--text-muted)" : "var(--text-primary)" }}>{s.label}</span>
                {s.hint && <span className="mt-0.5 block text-label leading-snug" style={{ color: "var(--text-muted)" }}>{s.hint}</span>}
              </span>
            </button>
          ))}
        </div>
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
