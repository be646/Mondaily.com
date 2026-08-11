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

/** Anything renderable as text, or "" — never an object, which React refuses to render. */
function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const described = readable(v);
  if (described) return described;
  try { return JSON.stringify(v).slice(0, 300); } catch { return String(v); }
}

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
  // Coerced at the CHOKEPOINT, not only in describeError. Rendering a non-string here throws React
  // error #31 and unmounts the page — a banner meant to report a failure taking the whole screen
  // down is strictly worse than the silent save it replaced. describeError is one caller; callers
  // written later will not remember this, and TypeScript cannot help when the value arrives from a
  // JSON.parse. Same lesson as the mutation cache itself: a rule at one call site is not a rule.
  text = asText(text) || "Something went wrong.";
  detail = detail === undefined ? undefined : (asText(detail) || undefined);
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
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    return readable(parsed.error) ?? readable(parsed.message) ?? raw;
  } catch { return raw; }
}

/**
 * Coerce whatever sat under `error` into a sentence, or null if there is nothing usable.
 *
 * `error` is NOT always a string. `@hono/zod-validator` answers a failed body validation with
 * `{"success":false,"error":{"issues":[…],"name":"ZodError"}}`, so the field is an OBJECT. The first
 * version returned it as-is under a `string` type annotation — a lie the cast let through — and the
 * alert banner then rendered an object as a React child.
 *
 * That is React error #31, and it does not fail quietly: it unmounts the tree, so the page goes to
 * the error boundary. MEASURED in production 2026-08-11 — 5 occurrences on /calendar, reported as
 * "calendar shows react error and many pages show react error". Many pages, because the
 * MutationCache default routes EVERY failed mutation through here, so one bad shape broke all of
 * them at once.
 *
 * Zod's issues carry the useful part — which field, and why — so they are turned into the sentence
 * the user needed in the first place rather than discarded.
 */
function readable(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (!v || typeof v !== "object") return null;

  const issues = (v as { issues?: unknown }).issues;
  if (Array.isArray(issues) && issues.length) {
    const parts = issues
      .map(i => {
        const issue = i as { path?: unknown[]; message?: unknown };
        const field = Array.isArray(issue.path) ? issue.path.filter(p => p !== undefined).join(".") : "";
        const msg = typeof issue.message === "string" ? issue.message : "is invalid";
        return field ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.slice(0, 3).join("; ");
  }

  // Some endpoints answer { error: { message: "…" } }.
  const nested = (v as { message?: unknown }).message;
  if (typeof nested === "string" && nested.trim()) return nested.trim();

  return null;
}
