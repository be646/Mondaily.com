import { useSovereignAuth } from "../components/auth/sovereign-auth-context";

/**
 * Unified identity hook — the single source for "who is signed in". Now sovereign-only
 * (Clerk fully removed): reads our native cookie session. SovereignAuthProvider is the root
 * of the app, so the context is always present.
 */
export interface CurrentUser {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  workspaceId: string | null;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  /** From the SERVER (workspaces.onboarded), not a localStorage flag. */
  onboarded: boolean;
}

function workspaceFromStorage(): string | null {
  try { return localStorage.getItem("mondaily_workspace_id"); } catch { return null; }
}

export function useCurrentUser(): CurrentUser {
  const sov = useSovereignAuth();
  return {
    isLoaded: sov.status !== "loading",
    isSignedIn: sov.status === "authenticated",
    userId: sov.user?.userId ?? null,
    workspaceId: workspaceFromStorage(),
    email: sov.user?.email ?? null,
    name: sov.user?.name ?? null,
    imageUrl: sov.user?.imageUrl ?? null,
    onboarded: sov.user?.onboarded ?? true,
  };
}
