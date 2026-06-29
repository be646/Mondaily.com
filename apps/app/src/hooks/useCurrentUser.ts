import { useAuth, useUser } from "@clerk/react";
import { useSovereignAuthOptional } from "../components/auth/sovereign-auth-context";
import { USE_SOVEREIGN_AUTH } from "../lib/api-client";

/**
 * Unified identity adapter — the single source the app reads for "who is signed in", regardless
 * of which auth runtime is active. Flag mirrors the api-client + middleware:
 *   VITE_USE_SOVEREIGN_AUTH==='true' → our native cookie session (useSovereignAuth)
 *   else                            → Clerk (useUser/useAuth)
 *
 * Both Clerk hooks and the (optional) sovereign hook are called UNCONDITIONALLY every render so
 * hook order is stable — the flag is a build constant, and ClerkProvider is mounted in both modes,
 * so this never violates the rules of hooks. We only branch on which result we RETURN.
 */
export interface CurrentUser {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  workspaceId: string | null;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
}

function workspaceFromStorage(): string | null {
  try { return localStorage.getItem("mondaily_workspace_id"); } catch { return null; }
}

export function useCurrentUser(): CurrentUser {
  const clerk = useAuth();
  const { user } = useUser();
  const sov = useSovereignAuthOptional();
  const workspaceId = workspaceFromStorage(); // persisted by both runtimes

  if (USE_SOVEREIGN_AUTH) {
    return {
      isLoaded: sov ? sov.status !== "loading" : true,
      isSignedIn: sov?.status === "authenticated",
      userId: sov?.user?.userId ?? null,
      workspaceId,
      email: sov?.user?.email ?? null,
      name: sov?.user?.name ?? null,
      imageUrl: sov?.user?.imageUrl ?? null,
    };
  }

  return {
    isLoaded: !!clerk.isLoaded,
    isSignedIn: !!clerk.isSignedIn,
    userId: clerk.userId ?? null,
    workspaceId,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    name: user?.fullName ?? null,
    imageUrl: user?.imageUrl ?? null,
  };
}
