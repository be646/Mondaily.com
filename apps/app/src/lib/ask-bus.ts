/**
 * Ask bus — a tiny primitive so any surface (the AI Inspector, a record page, a report) can open
 * the existing Ask drawer and send a contextual question, WITHOUT duplicating the Ask engine.
 * The drawer already owns the engine (useAskEngine + doSend); this just carries a pending prompt
 * across the "open the drawer, then send" boundary so it works whether the drawer is already open
 * or opens fresh in response to the event.
 */
const EVENT = "mondaily:ask";
let pending: string | null = null;

/** Queue a prompt and ask the drawer to open + send it. */
export function requestAsk(prompt: string) {
  pending = prompt.trim() || null;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Drain the queued prompt (returns it once, then null). */
export function takePendingAsk(): string | null {
  const p = pending;
  pending = null;
  return p;
}

export const ASK_EVENT = EVENT;
