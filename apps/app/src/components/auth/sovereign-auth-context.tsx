import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BASE_URL } from "../../lib/api-client";

/**
 * Shadow-mode client for Sovereign Auth (/api/v1/auth/*). Runs ENTIRELY in parallel to Clerk:
 * its own cookie-based session, its own context — it never touches Clerk's hooks or session,
 * so the two coexist without collision. Cookies are HttpOnly, so we never read tokens in JS;
 * we just call the endpoints with credentials:"include" and trust the browser.
 */
const AUTH_URL = `${BASE_URL}/api/v1/auth`;

async function authCall<T = Record<string, unknown>>(path: string, body?: unknown, method: "GET" | "POST" = "POST"): Promise<{ status: number; data: T }> {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export interface SovereignUser { userId: string; email: string }
type Status = "loading" | "authenticated" | "unauthenticated";

interface SovereignAuthValue {
  status: Status;
  user: SovereignUser | null;
  /** Returns { requiresActivation: true } for legacy Clerk users with no password yet. */
  login: (email: string, password: string) => Promise<{ requiresActivation?: boolean }>;
  activate: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
}

const Ctx = createContext<SovereignAuthValue | null>(null);

export function SovereignAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SovereignUser | null>(null);
  const booted = useRef(false);

  // Persist the session's workspace so the existing apiClient (X-Workspace-Id header) works
  // unchanged in sovereign mode — mirrors what AuthGate does in the Clerk flow.
  const persistWorkspace = (wsId?: string | null) => { if (wsId) localStorage.setItem("mondaily_workspace_id", wsId); };
  const setAuthed = (u: SovereignUser, wsId?: string | null) => { persistWorkspace(wsId); setUser(u); setStatus("authenticated"); };
  const setGuest = () => { setUser(null); setStatus("unauthenticated"); };

  const refresh = useCallback(async (): Promise<boolean> => {
    const r = await authCall<{ userId?: string }>("/refresh");
    if (r.status !== 200 || !r.data.userId) return false;
    const me = await authCall<{ userId?: string; email?: string; workspaceId?: string }>("/me", undefined, "GET");
    if (me.status === 200 && me.data.userId) { setAuthed({ userId: me.data.userId, email: me.data.email ?? "" }, me.data.workspaceId); return true; }
    return false;
  }, []);

  // Bootstrap once: /me → on 401 try a silent refresh → else guest. Guarded so it never loops.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const me = await authCall<{ userId?: string; email?: string; workspaceId?: string }>("/me", undefined, "GET");
      if (me.status === 200 && me.data.userId) { setAuthed({ userId: me.data.userId, email: me.data.email ?? "" }, me.data.workspaceId); return; }
      if (!(await refresh())) setGuest();
    })().catch(setGuest);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await authCall<{ userId?: string; email?: string; workspaceId?: string; requires_activation?: boolean; error?: string }>("/login", { email, password });
    if (r.status === 200 && r.data.requires_activation) return { requiresActivation: true };
    if (r.status === 200 && r.data.userId) { setAuthed({ userId: r.data.userId, email: r.data.email ?? email }, r.data.workspaceId); return {}; }
    throw new Error(r.data.error || "Invalid email or password.");
  }, []);

  const activate = useCallback(async (email: string, password: string) => {
    const r = await authCall<{ userId?: string; email?: string; workspaceId?: string; error?: string }>("/activate", { email, password });
    if (r.status === 201 && r.data.userId) { setAuthed({ userId: r.data.userId, email: r.data.email ?? email }, r.data.workspaceId); return; }
    throw new Error(r.data.error || "Activation failed.");
  }, []);

  const logout = useCallback(async () => {
    await authCall("/logout").catch(() => {});
    setGuest();
  }, []);

  return <Ctx.Provider value={{ status, user, login, activate, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useSovereignAuth(): SovereignAuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSovereignAuth must be used within <SovereignAuthProvider>");
  return v;
}
