import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider, useAuth, useOrganization } from "@clerk/react";
import { App } from "./App";
import { setTokenProvider } from "./lib/api-client";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false }
  }
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { organization, isLoaded: orgLoaded } = useOrganization();

  // ready: true once Clerk has loaded and we've either confirmed no session or
  // completed bootstrap. Starts false — nothing renders until we know what's going on.
  const [ready, setReady] = useState(false);

  // Track previous sign-in state so we know when a fresh sign-in occurs
  const prevSignedIn = useRef<boolean | null>(null);
  // Guard against concurrent bootstrap calls
  const bootstrapping = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;

    // ── Signed out ────────────────────────────────────────────────────────────
    if (!isSignedIn) {
      localStorage.removeItem("mondaily_session_token");
      localStorage.removeItem("mondaily_workspace_id");
      localStorage.removeItem("mondaily_onboarding_done");
      localStorage.removeItem("mondaily_needs_onboarding");
      setTokenProvider(() => Promise.resolve(null));
      prevSignedIn.current = false;
      setReady(true);
      return;
    }

    // ── Signed in ─────────────────────────────────────────────────────────────
    setTokenProvider(() => getToken());

    // Wait until Clerk has resolved org membership before bootstrapping.
    // orgLoaded=true even when the user has no org (organization will be null).
    if (!orgLoaded) return;

    // If a fresh sign-in just happened (transition false→true), always bootstrap
    // so the workspace UUID is guaranteed to be set before the app renders.
    const freshSignIn = prevSignedIn.current === false;
    prevSignedIn.current = true;

    // Already have a UUID and this isn't a fresh sign-in — nothing to do.
    const existing = localStorage.getItem("mondaily_workspace_id");
    if (!freshSignIn && existing && existing.length === 36) {
      setReady(true);
      return;
    }

    // Need to (re-)bootstrap. Block render while we resolve.
    if (bootstrapping.current) return;
    bootstrapping.current = true;
    setReady(false); // hide the app while we resolve the workspace UUID

    (async () => {
      try {
        const token = await getToken();
        if (token) {
          const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
          const body: Record<string, string> = {};
          if (organization?.id) {
            body.clerk_org_id = organization.id;
            body.name = organization.name ?? "My Workspace";
          }
          // Retry with backoff so a transient network/5xx blip during signup
          // doesn't leave the user without a workspace. Bootstrap is idempotent
          // (finds-or-creates by clerk_org_id), so retrying is safe and also
          // recovers an orphaned Clerk org. A 4xx (e.g. 401 deleted account) is
          // terminal — retrying won't help.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const res = await fetch(`${apiBase}/api/v1/onboarding/bootstrap`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
              });
              if (res.ok) {
                const { workspace_id, is_new } = (await res.json()) as { workspace_id: string; is_new?: boolean };
                localStorage.setItem("mondaily_workspace_id", workspace_id);
                if (is_new) localStorage.setItem("mondaily_needs_onboarding", "1");
                break;
              }
              if (res.status < 500) break; // client error — don't retry
            } catch { /* network error — fall through to retry */ }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          }
        }
      } catch { /* non-fatal */ }
      bootstrapping.current = false;
      setReady(true);
    })();
  }, [isLoaded, isSignedIn, orgLoaded, organization, getToken]);

  if (!ready) return null;
  return <>{children}</>;
}

// Apply saved theme before first render to avoid flash
(function initTheme() {
  // One-time migration: light is the new default — reset existing devices once
  // (they can switch back to dark from Settings → Appearance).
  if (!localStorage.getItem("mondaily_theme_light_reset")) {
    localStorage.setItem("mondaily_appearance", "light");
    localStorage.setItem("mondaily_theme_light_reset", "1");
  }
  const saved = localStorage.getItem("mondaily_appearance") as "dark" | "light" | "system" | null;
  const mode = saved ?? "light";
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      appearance={{ elements: { badge: "hidden", logoBox: "hidden" } }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthGate>
            <App />
          </AuthGate>
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>
);
