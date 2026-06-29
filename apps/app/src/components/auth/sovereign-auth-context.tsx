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

export interface SovereignUser { userId: string; email: string; name: string | null; imageUrl: string | null }
type Status = "loading" | "authenticated" | "unauthenticated";

interface SovereignAuthValue {
  status: Status;
  user: SovereignUser | null;
  /** Returns { requiresActivation: true } for legacy users with no password yet. */
  login: (email: string, password: string) => Promise<{ requiresActivation?: boolean }>;
  /** New account: creates credentials + a fresh workspace (owner). */
  register: (email: string, password: string, name?: string) => Promise<void>;
  activate: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  /** Re-fetch /me and update the cached profile (e.g. after an avatar/name change). */
  reloadProfile: () => Promise<void>;
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

  type MeResp = { userId?: string; email?: string; name?: string | null; imageUrl?: string | null; workspaceId?: string };
  const toUser = (d: MeResp, fallbackEmail = ""): SovereignUser => ({ userId: d.userId!, email: d.email ?? fallbackEmail, name: d.name ?? null, imageUrl: d.imageUrl ?? null });

  const refresh = useCallback(async (): Promise<boolean> => {
    const r = await authCall<{ userId?: string }>("/refresh");
    if (r.status !== 200 || !r.data.userId) return false;
    const me = await authCall<MeResp>("/me", undefined, "GET");
    if (me.status === 200 && me.data.userId) { setAuthed(toUser(me.data), me.data.workspaceId); return true; }
    return false;
  }, []);

  // Bootstrap once: /me → on 401 try a silent refresh → else guest. Guarded so it never loops.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const me = await authCall<MeResp>("/me", undefined, "GET");
      if (me.status === 200 && me.data.userId) { setAuthed(toUser(me.data), me.data.workspaceId); return; }
      if (!(await refresh())) setGuest();
    })().catch(setGuest);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await authCall<MeResp & { requires_activation?: boolean; error?: string }>("/login", { email, password });
    if (r.status === 200 && r.data.requires_activation) return { requiresActivation: true };
    if (r.status === 200 && r.data.userId) { setAuthed(toUser(r.data, email), r.data.workspaceId); return {}; }
    throw new Error(r.data.error || "Invalid email or password.");
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const r = await authCall<MeResp & { error?: string }>("/register", { email, password, name });
    if (r.status === 201 && r.data.userId) { setAuthed(toUser(r.data, email), r.data.workspaceId); return; }
    throw new Error(r.data.error || "Registration failed.");
  }, []);

  const activate = useCallback(async (email: string, password: string) => {
    const r = await authCall<MeResp & { error?: string }>("/activate", { email, password });
    if (r.status === 201 && r.data.userId) { setAuthed(toUser(r.data, email), r.data.workspaceId); return; }
    throw new Error(r.data.error || "Activation failed.");
  }, []);

  const logout = useCallback(async () => {
    await authCall("/logout").catch(() => {});
    setGuest();
  }, []);

  const reloadProfile = useCallback(async () => {
    const me = await authCall<MeResp>("/me", undefined, "GET");
    if (me.status === 200 && me.data.userId) setAuthed(toUser(me.data), me.data.workspaceId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ status, user, login, register, activate, logout, refresh, reloadProfile }}>{children}</Ctx.Provider>;
}

export function useSovereignAuth(): SovereignAuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSovereignAuth must be used within <SovereignAuthProvider>");
  return v;
}

/** Non-throwing accessor — returns null when the provider isn't mounted (Clerk mode).
 *  Lets the unified useCurrentUser() call it unconditionally without violating hook rules. */
export function useSovereignAuthOptional(): SovereignAuthValue | null {
  return useContext(Ctx);
}
