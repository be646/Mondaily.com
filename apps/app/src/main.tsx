import React, { useEffect, useState } from "react";
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
  // bootstrapped: true once we've either confirmed no session or resolved a workspace UUID
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      // Signed out — clear everything and unblock immediately
      localStorage.removeItem("mondaily_session_token");
      localStorage.removeItem("mondaily_workspace_id");
      localStorage.removeItem("mondaily_onboarding_done");
      setTokenProvider(() => Promise.resolve(null));
      setBootstrapped(true);
      return;
    }

    // Signed in — register token provider immediately
    setTokenProvider(() => getToken());

    // If org state isn't known yet, wait
    if (!orgLoaded) return;

    // If we already have a valid workspace UUID, no bootstrap needed
    const existing = localStorage.getItem("mondaily_workspace_id");
    if (existing && existing.length === 36) {
      setBootstrapped(true);
      return;
    }

    // Call bootstrap to resolve/create the Supabase workspace UUID
    (async () => {
      try {
        const token = await getToken();
        if (!token) { setBootstrapped(true); return; }
        const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
        const body: Record<string, string> = {};
        if (organization?.id) {
          body.clerk_org_id = organization.id;
          body.name = organization.name ?? "My Workspace";
        }
        const res = await fetch(`${apiBase}/api/v1/onboarding/bootstrap`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const { workspace_id } = (await res.json()) as { workspace_id: string };
          localStorage.setItem("mondaily_workspace_id", workspace_id);
        }
      } catch { /* non-fatal — let DashboardRoute handle missing workspace */ }
      setBootstrapped(true);
    })();
  }, [isLoaded, isSignedIn, orgLoaded, organization, getToken]);

  // Block all rendering until we know session state and (for signed-in users) workspace
  if (!bootstrapped) return null;
  return <>{children}</>;
}

// Apply saved theme before first render to avoid flash
(function initTheme() {
  const saved = localStorage.getItem("mondaily_appearance") as "dark" | "light" | "system" | null;
  const mode = saved ?? "dark";
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
