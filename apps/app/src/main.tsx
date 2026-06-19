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
  const [ready, setReady] = useState(false);

  // Phase 1: unblock render as soon as we know auth state
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      localStorage.removeItem("mondaily_session_token");
      localStorage.removeItem("mondaily_workspace_id");
      setTokenProvider(() => Promise.resolve(null));
      setReady(true);
      return;
    }
    setTokenProvider(() => getToken());
    setReady(true);
  }, [isLoaded, isSignedIn, getToken]);

  // Phase 2: exchange Clerk org ID for Supabase workspace UUID via bootstrap endpoint.
  // Runs silently on every org load/change; never blocks render.
  useEffect(() => {
    if (!isSignedIn || !orgLoaded || !organization?.id) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
        const res = await fetch(`${apiBase}/api/v1/onboarding/bootstrap`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ clerk_org_id: organization.id, name: organization.name }),
        });
        if (res.ok) {
          const { workspace_id } = (await res.json()) as { workspace_id: string };
          localStorage.setItem("mondaily_workspace_id", workspace_id);
        }
      } catch { /* non-fatal */ }
    })();
  }, [isSignedIn, orgLoaded, organization, getToken]);

  if (!ready) return null;
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
