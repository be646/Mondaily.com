import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-white/[.035]" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50/40 px-6 text-center dark:border-indigo-500/10 dark:bg-indigo-500/[.03]">
      <AlertTriangle className="mb-3 text-indigo-400" size={26} />
      <h2 className="text-sm font-medium text-[#111827] dark:text-slate-200">Something went wrong</h2>
      <p className="mt-1 max-w-sm text-sm text-[#6b7280] dark:text-slate-500">
        {error?.message ?? "An unexpected error occurred. Please try again."}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-1.5 rounded-lg border border-[#e5e7eb] px-3 py-1.5 text-xs text-[#6b7280] hover:text-[#111827] hover:border-[#cbd5e1] transition-colors dark:border-white/10 dark:text-slate-400 dark:hover:text-white dark:hover:border-white/20"
        >
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
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-[#d1d5db] px-6 text-center dark:border-white/10">
      <Icon className="mb-3 text-[#9ca3af] dark:text-slate-600" size={28} />
      <h2 className="text-sm font-medium text-[#111827] dark:text-slate-200">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[#6b7280] dark:text-slate-500">{description}</p>
      {aiHint && (
        <p className="mt-2.5 flex items-center gap-1.5 max-w-sm text-xs text-indigo-600 dark:text-indigo-400">
          <Sparkles size={11} className="shrink-0"/>
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
        <h1 className="text-xl font-semibold text-[#111827] dark:text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-[#6b7280] dark:text-slate-500">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
