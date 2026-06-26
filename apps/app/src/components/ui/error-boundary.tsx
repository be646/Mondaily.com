import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean }

/** Catches render errors in its subtree and shows a graceful fallback instead of
 *  white-screening — used to wrap the onboarding flow so a step error can't wedge
 *  a brand-new user mid-signup. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Something went wrong on this step.</p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Your account is fine — please refresh to continue.</p>
        <button
          onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
          className="rounded-lg border px-4 py-2 text-sm font-medium"
          style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
        >
          Reload
        </button>
      </div>
    );
  }
}
