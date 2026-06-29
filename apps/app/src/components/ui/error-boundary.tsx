import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; message: string }

/** Catches render errors in its subtree and shows a graceful, recoverable fallback instead of
 *  white/black-screening the whole app. Wraps the dashboard content + onboarding so one broken
 *  page can't unmount everything. The fallback surfaces the error message for diagnosis. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Something went wrong on this page</p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>The rest of the app is fine. Try again, or reload.</p>
        {this.state.message && (
          <pre className="max-w-full overflow-x-auto rounded-lg border px-3 py-2 text-left text-[11px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-faint)" }}>{this.state.message}</pre>
        )}
        <div className="mt-1 flex gap-2">
          <button onClick={() => this.setState({ hasError: false, message: "" })} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>Try again</button>
          <button onClick={() => window.location.reload()} className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}>Reload</button>
        </div>
      </div>
    );
  }
}
