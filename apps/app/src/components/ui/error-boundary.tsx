import { Component, type ReactNode } from "react";
// The one definition of the API origin — not a second copy of the same env expression.
import { BASE_URL } from "../../lib/api-client";

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; message: string }

// A failed lazy-chunk load — almost always a stale chunk hash after a deploy while the tab was open,
// or a transient network blip. Reloading fetches the fresh index.html + new chunk URLs and recovers.
const CHUNK_RE = /Loading chunk|ChunkLoadError|dynamically imported module|Importing a module script failed|Failed to fetch dynamically|error loading dynamically imported/i;
const RELOAD_FLAG = "mondaily_chunk_reloaded";
// After a healthy 6s post-reload, clear the guard so a LATER chunk error (e.g. a second deploy this
// session) can auto-recover again — while still preventing an immediate reload loop.
try { if (typeof window !== "undefined") setTimeout(() => { try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ } }, 6000); } catch { /* ignore */ }

/** Catches render errors in its subtree and shows a graceful, recoverable fallback instead of
 *  white/black-screening the whole app. Chunk-load errors (stale chunks after a deploy) auto-reload
 *  ONCE to fetch fresh assets — so a routine deploy never strands the user on a "reload" screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const isChunk = CHUNK_RE.test(msg);

    /**
     * REPORT FIRST, THEN RECOVER.
     *
     * The chunk branch used to `return` before the reporting below, so a stale-chunk error — by far
     * the most common render error in a deployed SPA — was NEVER recorded. `client_errors` sat
     * quiet for days while users hit them on every lazy route after a deploy, and the only evidence
     * was someone saying "I keep getting a react error". A whole class of production failure was
     * invisible, and the auto-reload is precisely what made it invisible: it fixed the symptom and
     * erased the trace.
     *
     * `keepalive` is what makes this safe to do before a reload — the browser finishes the request
     * even as the page tears down. Reporting is best-effort and never blocks the recovery.
     */
    this.report(msg, isChunk);

    // Auto-recover from a stale-chunk load: reload once (guarded against loops) to pull fresh assets.
    if (isChunk) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, "1");
          window.location.reload();
          return;
        }
      } catch { /* sessionStorage blocked — fall through to the manual fallback */ }
    }
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error);
  }

  /**
   * Report it somewhere a human will actually look.
   *
   * console.error goes into a browser nobody is watching. Until this existed, a render error in
   * production was invisible unless a user described it — and a user rarely can.
   *
   * BEST EFFORT, and silent on failure: an error reporter that throws, blocks, or retries would
   * turn one broken component into a broken app. `keepalive` is what lets this run BEFORE the
   * chunk-recovery reload — the browser completes the request as the page tears down.
   *
   * Chunk errors are TAGGED rather than filtered out. They are expected after a deploy and they
   * self-heal, but a spike of them is the difference between "one user had a stale tab" and "every
   * user is being bounced", and that is only visible if they are recorded at all.
   */
  private report(msg: string, isChunk: boolean) {
    try {
      const body = JSON.stringify({
        message: `${isChunk ? "[stale-chunk] " : ""}${msg}`.slice(0, 2000),
        route: typeof location !== "undefined" ? location.pathname : undefined,
        source: "client",
      });
      void fetch(`${BASE_URL}/api/v1/telemetry/error`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "include",
        keepalive: true,
      }).catch(() => { /* never surface a reporting failure to the user */ });
    } catch { /* never let reporting break the fallback render */ }
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
