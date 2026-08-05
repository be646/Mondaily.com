import { useEffect, useState } from "react";
import { BASE_URL } from "../../lib/api-client";
import type { AuthTrace } from "../../lib/auth-trace";

/**
 * "Continue with Google" — identity only.
 *
 * Renders NOTHING when the deployment has no Google client configured, rather than showing a button
 * that dead-ends in a 503. A sign-in page that offers a method it cannot perform is worse than one
 * that offers fewer methods.
 *
 * The consent it requests is `openid email profile` and nothing else (see GOOGLE_LOGIN_SCOPES) —
 * connecting a mailbox stays a separate, later opt-in, so signing in never shows a consent screen
 * asking to read your email.
 */

/** Google's mark, inline. An external image would be blocked and a coloured emoji is not the logo. */
function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.3z"/>
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.500 46 24 46z"/>
      <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.3-3 .7-4.3v-5.7H4.5C2.9 17.2 2 20.5 2 24s.9 6.8 2.5 10l7.3-5.7z"/>
      <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.8 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"/>
    </svg>
  );
}

/** Callback failures come back as ?sso=<reason>. Plain language, never the provider's raw error. */
const SSO_REASON: Record<string, string> = {
  state: "That sign-in link expired or was opened in a different browser. Please try again.",
  declined: "Google sign-in was cancelled.",
  nocode: "Google didn't complete the sign-in. Please try again.",
  exchange: "We couldn't confirm your Google account. Please try again.",
  unverified: "That Google account hasn't verified its email address, so we can't sign you in with it. Use your email and password instead.",
  create: "We couldn't create your account just now. Please try again.",
  workspace: "Your account was created but the workspace didn't finish setting up. Please try again.",
};

export function ssoErrorMessage(reason: string | null): string | null {
  return reason ? (SSO_REASON[reason] ?? "Google sign-in didn't complete. Please try again.") : null;
}

export function GoogleAuthButton({ next, mode, onTrace }: {
  next: string;
  mode: "signin" | "signup";
  /** Emits the one honest client-side step: handing off to Google. */
  onTrace?: AuthTrace;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    // Ask the API whether Google is configured. Fail CLOSED — an unreachable probe hides the button
    // rather than showing one that cannot work.
    fetch(`${BASE_URL}/api/v1/auth/google/available`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { available: false })
      .then(j => { if (alive) setAvailable(Boolean((j as { available?: boolean }).available)); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  if (!available) return null;

  return (
    <button
      type="button"
      onClick={() => {
        onTrace?.emit("run", "handing off to Google", "openid · email · profile");
        // A full navigation, not fetch: the OAuth consent screen is a page the user must actually
        // see and interact with.
        window.location.href = `${BASE_URL}/api/v1/auth/google/start?next=${encodeURIComponent(next)}`;
      }}
      className="flex w-full items-center justify-center gap-2.5 rounded-sm border border-[var(--border-soft)] bg-zinc-950 px-4 py-2.5 text-body font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--text-faint)]"
    >
      <GoogleMark />
      {mode === "signup" ? "Sign up with Google" : "Continue with Google"}
    </button>
  );
}

/** "or" rule between the SSO button and the credential form. */
export function AuthDivider() {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-[var(--border-soft)]" />
      <span className="text-caption uppercase tracking-[0.2em] text-[var(--text-faint)]">or</span>
      <span className="h-px flex-1 bg-[var(--border-soft)]" />
    </div>
  );
}
