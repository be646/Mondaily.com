import { AlertTriangle, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-lg border border-white/10 bg-white/[.035]" />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-indigo-500/10 bg-indigo-500/[.03] px-6 text-center">
      <AlertTriangle className="mb-3 text-indigo-400/60" size={26} />
      <h2 className="text-sm font-medium text-slate-200">Something went wrong</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        {error?.message ?? "An unexpected error occurred. Please try again."}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white hover:border-white/20 transition-colors"
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
  action
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 px-6 text-center">
      <Icon className="mb-3 text-slate-600" size={28} />
      <h2 className="text-sm font-medium text-slate-200">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}
