/**
 * Persistent Help session — the model behind the AI Help Center. The whole inquiry (messages,
 * diagnostics, suggested actions, routes visited, ticket state, rating) lives here and is mirrored to
 * localStorage, so the conversation survives route changes, panel close/reopen, and full reloads.
 * It is per-workspace so switching workspaces starts a fresh inquiry.
 */
export interface HelpDiagnostic { label: string; status: "ok" | "warn" | "error" | "info"; detail: string; source: string }
export interface HelpAction { label: string; action: "navigate" | "create_ticket" | "follow_up"; payload?: string }
export interface HelpMsg {
  role: "user" | "assistant";
  content: string;
  category?: string;
  needsTicket?: boolean;
  suggestedSubject?: string;
  diagnostics?: HelpDiagnostic[];
  actions?: HelpAction[];
  system?: boolean;   // a note the panel added (e.g. "I opened Discovery") — not from the model
  /** Which brain answered (knowledge | repair | builder) — shown as a small chip. */
  brain?: "knowledge" | "repair" | "builder";
  /** What the agent's tools ACTUALLY did this turn — rendered so acting is never invisible. */
  toolLog?: { tool: string; summary: string }[];
}

export type HelpState = "active" | "waiting_for_user" | "resolved" | "escalated" | "closed";

export interface HelpSession {
  id: string;
  messages: HelpMsg[];
  category: string | null;
  subject: string | null;         // current inquiry subject (first user message)
  /**
   * The agent's own one-line summary of the problem.
   *
   * Kept SEPARATE from `subject` because they answer different questions: `subject` is the raw first
   * message and makes an honest panel title while the user is still typing, whereas this is what the
   * ticket and every support email should be called. Collapsing them meant `subject` was already set
   * by the time the agent replied, so its summary lost the `||` and every ticket was titled with the
   * user's whole opening paragraph, truncated mid-word.
   */
  agentSubject: string | null;
  ticketId: string | null;        // set once a support request is created
  ticketCreated: boolean;
  routeHistory: string[];         // routes the user opened FROM Help
  lastRoute: string | null;
  state: HelpState;
  rating: number | null;          // 1–5 after resolution
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

const PREFIX = "mondaily_help_session_";

function workspaceId(): string {
  try { return localStorage.getItem("mondaily_workspace_id") || "default"; } catch { return "default"; }
}
export function sessionKey(): string { return `${PREFIX}${workspaceId()}`; }

export function newSession(): HelpSession {
  const now = new Date().toISOString();
  return {
    id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    messages: [], category: null, subject: null, agentSubject: null, ticketId: null, ticketCreated: false,
    routeHistory: [], lastRoute: null, state: "active", rating: null, feedback: null,
    createdAt: now, updatedAt: now,
  };
}

export function loadSession(key: string): HelpSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as HelpSession;
    if (!s || !Array.isArray(s.messages)) return null;

    /**
     * VALIDATE THE ELEMENTS, not just the array.
     *
     * localStorage is untrusted input: it can hold a session written by ANY previous version of
     * this app, half-written by a tab that closed mid-save, or edited by hand. The old check
     * confirmed `messages` was an array and then trusted every element in it, so a single null or
     * legacy-shaped entry reached code that reads `m.role` and `m.category`.
     *
     * That matters more here than almost anywhere else: HelpProvider sits ABOVE the router Outlet
     * and builds this in a useState INITIALIZER, so a throw is not a broken panel — it is the whole
     * application replaced by an error card with no sidebar to navigate away with. Exactly what was
     * reported on /ask/new: "Cannot read properties of undefined (reading 'category')".
     *
     * Malformed entries are dropped rather than repaired. A conversation missing a turn is
     * recoverable; an app that will not start is not.
     */
    const messages = s.messages.filter(
      (m): m is HelpMsg => Boolean(m) && typeof m === "object" && typeof (m as HelpMsg).role === "string",
    );
    return { ...s, messages };
  } catch { return null; }
}

export function saveSession(key: string, s: HelpSession): void {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* storage full / disabled — session stays in memory */ }
}

/** True once an inquiry has real content and isn't closed — drives the "resume Help" pill. */
export function isSessionActive(s: HelpSession): boolean {
  return s.messages.length > 0 && s.state !== "closed";
}

/** A compact history summary for ticket metadata (keeps the full case without a huge payload). */
export function summarizeHistory(s: HelpSession, max = 20): string {
  return s.messages.slice(-max).map(m => `${m.role === "user" ? "User" : m.system ? "System" : "Help"}: ${m.content}`).join("\n");
}

/** Flatten the latest diagnostics seen in the conversation (most recent assistant answer wins). */
export function latestDiagnostics(s: HelpSession): HelpDiagnostic[] {
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const d = s.messages[i]?.diagnostics;
    if (d && d.length) return d;
  }
  return [];
}
