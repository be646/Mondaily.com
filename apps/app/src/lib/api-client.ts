export const BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API_URL = `${BASE_URL}/api/v1`;

// Sovereign auth: the session lives in HttpOnly cookies, sent on every request via
// credentials:"include". No bearer tokens. setTokenProvider is retained as a harmless no-op
// for any legacy callers.
let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>) {
  _getToken = fn;
}

// Returns the X-Workspace-Id header (+ Content-Type). Auth itself rides on the HttpOnly
// session cookie, so callers must also send credentials:"include" (use apiFetch, which does).
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = _getToken ? await _getToken() : null;
  const workspaceId = localStorage.getItem("mondaily_workspace_id");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
  };
}

// Single in-flight refresh shared across concurrent 401s (so a burst of expired-token
// requests triggers exactly one /auth/refresh, not one per call).
let _refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  if (!_refreshing) {
    _refreshing = fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" })
      .then(r => r.ok)
      .catch(() => false)
      .finally(() => { _refreshing = null; });
  }
  return _refreshing;
}

/**
 * Cookie-aware fetch for the raw (non-JSON-helper) call sites — streaming chat, file uploads,
 * generate, feedback, etc. Adds credentials:"include" (so the HttpOnly session cookie is sent —
 * the bug that broke chat after the Clerk→cookie cutover) and silently refreshes + retries once
 * on a 401. Takes a FULL url (same as the existing call sites) and returns the raw Response.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const workspaceId = localStorage.getItem("mondaily_workspace_id");
  const opts = (): RequestInit => ({
    ...init,
    credentials: "include",
    headers: { ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}), ...init?.headers },
  });
  let res = await fetch(input, opts());
  if (res.status === 401 && !input.includes("/api/v1/auth/")) {
    if (await refreshSession()) res = await fetch(input, opts());
  }
  return res;
}

// Hard ceiling so a hung/stalled backend request eventually REJECTS (→ the caller's error state)
// instead of leaving a page stuck on skeletons forever. Generous enough for slow AI generation.
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Re-resolve the active workspace from the SESSION when the stored one is rejected.
 *
 * The stored id and the signed-in user can drift apart — sign in as someone else in the same
 * browser, have a workspace removed from under you, restore a stale tab — and when they do, the
 * API answers 403 ("not in workspace") to EVERY request. Measured live on 2026-08-05: fourteen of
 * fourteen dashboard calls 403'd, and the app's only response was a yellow "what you see below may
 * be incomplete" banner. It never self-corrected, so the dashboard stayed broken until someone
 * manually switched workspace or cleared local storage.
 *
 * The session already knows the right answer — /auth/me returns the workspace this user actually
 * belongs to — so this is the 403 twin of the 401→refresh retry directly below.
 */
let realigning: Promise<string | null> | null = null;
async function realignWorkspace(): Promise<string | null> {
  // Share one in-flight probe: a dashboard fires a dozen queries at once and they would otherwise
  // each hit /auth/me on the same 403.
  realigning ??= (async () => {
    try {
      const r = await fetch(`${API_URL}/auth/me`, { credentials: "include" });
      if (!r.ok) return null;
      const me = (await r.json()) as { workspaceId?: string | null };
      const next = me.workspaceId ?? null;
      // Only act on an ACTUAL change. Rewriting the same value and retrying would turn a genuine
      // permission error into an infinite pair of requests.
      if (!next || next === localStorage.getItem("mondaily_workspace_id")) return null;
      localStorage.setItem("mondaily_workspace_id", next);
      return next;
    } catch { return null; }
    finally { setTimeout(() => { realigning = null; }, 0); }
  })();
  return realigning;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
  // Read the workspace on EVERY send, not once per request: a retry after realignment has to
  // carry the corrected id, and capturing it above would resend the rejected one.
  const send = () => {
    const workspaceId = localStorage.getItem("mondaily_workspace_id");
    return fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
        ...init?.headers,
      },
    });
  };

  let response = await send();

  // Access cookie expired (15-min TTL)? Silently refresh once via the 30-day refresh cookie
  // and retry. Skip for /auth/* so a failing refresh can't loop. This is what keeps chat,
  // tasks, and settings working past the access-token lifetime.
  if (response.status === 401 && !path.startsWith("/auth/")) {
    if (await refreshSession()) response = await send();
  }

  // Stored workspace no longer ours → adopt the session's and retry ONCE. A 403 that survives this
  // is a real permission error and is surfaced normally.
  if (response.status === 403 && !path.startsWith("/auth/")) {
    if (await realignWorkspace()) response = await send();
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `${init?.method || "GET"} ${path} failed`);
  }
  if (response.status === 204) return undefined as T;
  // Parse defensively: a fast page transition can abort a request mid-flight, leaving an empty or
  // truncated body. response.json() would THROW ("Unexpected end of JSON input") on that — instead
  // read the text, and return undefined for an empty body / unparseable payload so callers degrade
  // to their loading/empty guards rather than crashing the render tree.
  const text = await response.text().catch(() => "");
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
  } finally {
    clearTimeout(timer);
  }
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body) });
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  async delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  }
};
