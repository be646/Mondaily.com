/**
 * ALERTS — the app's own one-line feedback surface. No toast library.
 *
 * Built because settings was measured on 2026-08-05 and found to have 49 mutations of which only
 * 11 handled an error and 3 read `isError`. The other 38 failed SILENTLY: a toggle flipped, the
 * request 500'd, and the user was shown nothing at all. A save that quietly did not save is worse
 * than an error, because the user walks away believing the opposite of what is true.
 *
 * Deliberately an imperative module, not a hook: the thing that needs to raise an alert is
 * react-query's MutationCache, which lives outside React and has no component to call a hook from.
 * `ToastHost` is a different surface — it renders SERVER notifications; this renders what just
 * happened to the thing you clicked.
 */

export type AlertTone = "error" | "ok" | "info";

export interface AppAlert {
  id: number;
  tone: AlertTone;
  text: string;
  /** Extra context, shown smaller. Usually the server's own message. */
  detail?: string;
}

type Listener = (alerts: AppAlert[]) => void;

let alerts: AppAlert[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() { for (const l of listeners) l(alerts); }

export function subscribeAlerts(l: Listener): () => void {
  listeners.add(l);
  l(alerts);
  return () => { listeners.delete(l); };
}

export function dismissAlert(id: number) {
  alerts = alerts.filter(a => a.id !== id);
  emit();
}

/** Raise one. Errors persist until dismissed; successes fade, because they need no action. */
export function pushAlert(tone: AlertTone, text: string, detail?: string): number {
  const id = ++seq;
  // Cap the stack. A loop of failing requests must not bury the page in identical banners.
  alerts = [{ id, tone, text, detail }, ...alerts].slice(0, 3);
  emit();
  if (tone !== "error") setTimeout(() => dismissAlert(id), 4000);
  return id;
}

export const alertOk = (text: string, detail?: string) => pushAlert("ok", text, detail);
export const alertError = (text: string, detail?: string) => pushAlert("error", text, detail);

/**
 * Turn whatever a failed request threw into something a person can act on.
 *
 * apiClient rejects with the response body as the Error message, and the API answers with
 * `{"error":"..."}` — so the raw message is a JSON envelope. Showing that to a user is barely
 * better than showing nothing.
 */
export function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  if (!raw) return "Something went wrong. Please try again.";
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? raw;
  } catch { return raw; }
}
