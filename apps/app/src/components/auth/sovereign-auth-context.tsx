import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BASE_URL } from "../../lib/api-client";
import { getPow } from "../../lib/pow-client";
import type { Pow } from "../../lib/pow-client";
import { queryClient } from "../../lib/query-client";

// Wipe ALL client state that belongs to a previous session: the cached react-query data (so a new
// account never renders the prior user's tasks/workspace metrics) + the persisted workspace id +
// the onboarding marker. Called on every account boundary (login / register / logout).
function purgeSessionState() {
  queryClient.clear();
  localStorage.removeItem("mondaily_workspace_id");
  localStorage.removeItem("mondaily_needs_onboarding");
}

/**
 * Client for Sovereign Auth (/api/v1/auth/*) — the app's sole authentication runtime. Owns a
 * cookie-based session via its own context. Cookies are HttpOnly, so we never read tokens in JS;
 * we just call the endpoints with credentials:"include" and trust the browser.
 */
const AUTH_URL = `${BASE_URL}/api/v1/auth`;

async function authCall<T = Record<string, unknown>>(path: string, body?: unknown, method: "GET" | "POST" = "POST"): Promise<{ status: number; data: T }> {
  try {
    const res = await fetch(`${AUTH_URL}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, data };
  } catch {
    // Network error (offline, aborted mid-navigation, transient DNS/TLS blip). Return a synthetic
    // status 0 so callers can distinguish "couldn't reach the server" from a real 401 — and NOT log
    // the user out on a transient failure. This was the /calls direct-load false-logout: a boot-time
    // network blip threw here and dropped the session to guest → redirect to /auth/shadow-login.
    return { status: 0, data: {} as T };
  }
}

export interface SovereignUser { userId: string; email: string; name: string | null; imageUrl: string | null; emailVerified: boolean; onboarded: boolean }
type Status = "loading" | "authenticated" | "unauthenticated";

interface SovereignAuthValue {
  status: Status;
  user: SovereignUser | null;
  /** Returns { requiresActivation: true } for legacy users with no password yet. */
  login: (email: string, password: string) => Promise<{ requiresActivation?: boolean; mfaToken?: string }>;
  /** trustDevice=true asks the server to set the signed 30-day md_2fa_trust cookie. */
  completeMfa: (mfaToken: string, code: string, trustDevice?: boolean) => Promise<void>;
  /** New account: creates credentials + a fresh workspace (owner). Pass a pre-solved PoW to drive
   *  a visible shield; omit it and the call solves one internally. */
  register: (email: string, password: string, name?: string, pow?: Pow) => Promise<void>;
  /** Legacy bridge step 1: email a one-time activation link to the address on file. */
  requestActivation: (email: string, pow?: Pow) => Promise<void>;
  /** Legacy bridge step 2: set the password using the emailed token. */
  activate: (token: string, password: string) => Promise<void>;
  /** Email a short-lived password-reset link to the address on file. */
  requestPasswordReset: (email: string, pow?: Pow) => Promise<void>;
  /** Set a new password using the emailed reset token. Signs the user in — UNLESS 2FA is
   *  enrolled, in which case the password is reset but a second factor is still required:
   *  returns { mfaToken } for the caller to complete via completeMfa. */
  resetPassword: (token: string, password: string, pow?: Pow) => Promise<{ mfaToken?: string }>;
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
  // Only seed the workspace id when NONE is stored — never overwrite an explicit choice. Login/
  // register/activate call purgeSessionState() first (clearing it), so fresh sessions still get the
  // backend default; but a plain page-load boot must PRESERVE whatever workspace the user switched
  // to (otherwise every reload snapped back to the primary workspace).
  const persistWorkspace = (wsId?: string | null) => {
    if (wsId && !localStorage.getItem("mondaily_workspace_id")) localStorage.setItem("mondaily_workspace_id", wsId);
  };
  const setAuthed = (u: SovereignUser, wsId?: string | null) => { persistWorkspace(wsId); setUser(u); setStatus("authenticated"); };
  const setGuest = () => { setUser(null); setStatus("unauthenticated"); };

  type MeResp = { userId?: string; email?: string; name?: string | null; imageUrl?: string | null; workspaceId?: string; emailVerified?: boolean; onboarded?: boolean };
  const toUser = (d: MeResp, fallbackEmail = ""): SovereignUser => ({ userId: d.userId!, email: d.email ?? fallbackEmail, name: d.name ?? null, imageUrl: d.imageUrl ?? null, emailVerified: d.emailVerified ?? true,
  // Defaults TRUE: an unknown value must never trap an existing user in onboarding.
  onboarded: d.onboarded ?? true });

  const refresh = useCallback(async (): Promise<boolean> => {
    const r = await authCall<{ userId?: string }>("/refresh");
    if (r.status !== 200 || !r.data.userId) return false;
    const me = await authCall<MeResp>("/me", undefined, "GET");
    if (me.status === 200 && me.data.userId) { setAuthed(toUser(me.data), me.data.workspaceId); return true; }
    return false;
  }, []);

  // Once authenticated, solve a PoW and register it as a verified cryptographic claim for this
  // session — feeds the ABI oversight matrix's legitimacy signal. Fire-and-forget; never blocks UI.
  const claimSessionPow = () => {
    void (async () => {
      try { const pow = await getPow(); if (pow.pow_challenge) await authCall("/pow-claim", pow); } catch { /* best-effort */ }
    })();
  };

  // Bootstrap once: /me → on real 401 try a silent refresh → else guest. Guarded so it never loops.
  // A transient network error (authCall status 0) must NOT log the user out — retry a few times and
  // stay in "loading" (the route guards render null, not a redirect) before giving up. This is the
  // fix for the direct-navigation false-logout (e.g. loading /calls by URL) on a boot-time blip.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // PUBLIC guest routes (external call join) must never probe the authenticated session — a guest has
    // no account. Skipping /me here keeps the guest page free of any authenticated API call.
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/join/")) { setGuest(); return; }
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const me = await authCall<MeResp>("/me", undefined, "GET");
        if (me.status === 200 && me.data.userId) { setAuthed(toUser(me.data), me.data.workspaceId); claimSessionPow(); return; }
        if (me.status === 401) {
          // Genuine access-cookie expiry — the 30-day refresh cookie should renew it.
          if (await refresh()) return;
          setGuest(); return;
        }
        // Network error (status 0) / 5xx — a blip, not a logout. Back off and retry the boot.
        if (attempt < 2) await new Promise<void>(r => setTimeout(r, 500 * (attempt + 1)));
      }
      // Still can't reach the session endpoint after 3 attempts → guest (user can re-auth). Only
      // reached on a sustained outage, never a single transient failure.
      setGuest();
    })().catch(setGuest);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    // Solve the anti-bot proof-of-work (same gate as register/reset). Transparent to the user.
    const solved = await getPow();
    const r = await authCall<MeResp & { requires_activation?: boolean; mfa_required?: boolean; mfa_token?: string; error?: string }>("/login", { email, password, ...solved });
    if (r.status === 200 && r.data.requires_activation) return { requiresActivation: true };
    // 2FA: password accepted, second factor pending — hand the page the 5-minute mfa token.
    if (r.status === 200 && r.data.mfa_required && r.data.mfa_token) return { mfaToken: r.data.mfa_token };
    if (r.status === 200 && r.data.userId) { purgeSessionState(); setAuthed(toUser(r.data, email), r.data.workspaceId); return {}; }
    throw new Error(r.data.error || "Invalid email or password.");
  }, []);

  const completeMfa = useCallback(async (mfaToken: string, code: string, trustDevice = false) => {
    const r = await authCall<MeResp & { error?: string }>("/2fa/login", { mfa_token: mfaToken, code, trust_device: trustDevice });
    if (r.status === 200 && r.data.userId) { purgeSessionState(); setAuthed(toUser(r.data), r.data.workspaceId); return; }
    throw new Error(r.data.error || "That code didn't match.");
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string, pow?: Pow) => {
    const solved = pow ?? await getPow();
    const r = await authCall<MeResp & { error?: string }>("/register", { email, password, name, ...solved });
    if (r.status === 201 && r.data.userId) { purgeSessionState(); setAuthed(toUser(r.data, email), r.data.workspaceId); return; }
    throw new Error(r.data.error || "Registration failed.");
  }, []);

  const requestActivation = useCallback(async (email: string, pow?: Pow) => {
    const solved = pow ?? await getPow();
    await authCall("/request-activation", { email, ...solved });
  }, []);

  const activate = useCallback(async (token: string, password: string) => {
    const r = await authCall<MeResp & { error?: string }>("/activate", { token, password });
    if (r.status === 201 && r.data.userId) { purgeSessionState(); setAuthed(toUser(r.data), r.data.workspaceId); return; }
    throw new Error(r.data.error || "Activation failed.");
  }, []);

  const requestPasswordReset = useCallback(async (email: string, pow?: Pow) => {
    const solved = pow ?? await getPow();
    await authCall("/request-password-reset", { email, ...solved });
  }, []);

  const resetPassword = useCallback(async (token: string, password: string, pow?: Pow) => {
    const solved = pow ?? await getPow();
    const r = await authCall<MeResp & { ok?: boolean; mfa_required?: boolean; mfa_token?: string; error?: string }>("/reset-password", { token, password, ...solved });
    if (r.status === 200 && r.data.ok !== false) {
      // 2FA enrolled: password IS reset, but the reset link only proves email possession — the
      // second factor is still required before a session exists.
      if (r.data.mfa_required && r.data.mfa_token) return { mfaToken: r.data.mfa_token };
      const me = await authCall<MeResp>("/me", undefined, "GET");
      if (me.status === 200 && me.data.userId) { purgeSessionState(); setAuthed(toUser(me.data), me.data.workspaceId); }
      return {};
    }
    throw new Error(r.data.error || "Could not reset your password.");
  }, []);

  const logout = useCallback(async () => {
    await authCall("/logout").catch(() => {});
    purgeSessionState();
    setGuest();
  }, []);

  const reloadProfile = useCallback(async () => {
    const me = await authCall<MeResp>("/me", undefined, "GET");
    if (me.status === 200 && me.data.userId) setAuthed(toUser(me.data), me.data.workspaceId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={{ status, user, login, completeMfa, register, requestActivation, activate, requestPasswordReset, resetPassword, logout, refresh, reloadProfile }}>{children}</Ctx.Provider>;
}

export function useSovereignAuth(): SovereignAuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSovereignAuth must be used within <SovereignAuthProvider>");
  return v;
}

/** Non-throwing accessor — returns null when the provider isn't mounted.
 *  Lets the unified useCurrentUser() call it unconditionally without violating hook rules. */
export function useSovereignAuthOptional(): SovereignAuthValue | null {
  return useContext(Ctx);
}
