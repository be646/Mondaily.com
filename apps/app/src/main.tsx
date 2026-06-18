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

  useEffect(() => {
    let cancelled = false;

    async function syncAuth() {
      if (!isLoaded) return;

      if (!isSignedIn) {
        localStorage.removeItem("mondaily_session_token");
        localStorage.removeItem("mondaily_workspace_id");
        setTokenProvider(() => Promise.resolve(null));
        setReady(true);
        return;
      }

      if (!orgLoaded) return;

      setTokenProvider(() => getToken());

      const token = await getToken();
      if (cancelled) return;

      if (token) {
        localStorage.setItem("mondaily_session_token", token);
      } else {
        localStorage.removeItem("mondaily_session_token");
      }

      if (organization?.id) {
        const apiUrl = (import.meta.env.PROD ? "https://api.mondaily.com" : (import.meta.env.VITE_API_URL || "")).replace(/\/$/, "");
        const res = await fetch(`${apiUrl}/api/v1/onboarding/bootstrap`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            clerk_org_id: organization.id,
            name: organization.name,
          }),
        });

        if (res.ok) {
          const data = await res.json() as { workspace_id?: string };
          if (data.workspace_id) {
            localStorage.setItem("mondaily_workspace_id", data.workspace_id);
          }
        } else {
          localStorage.removeItem("mondaily_workspace_id");
        }
      } else {
        localStorage.removeItem("mondaily_workspace_id");

        const path = window.location.pathname;
        const authPath = path.startsWith("/sign-in") || path.startsWith("/sign-up");
        const onboardingPath = path.startsWith("/onboarding");
        const workspacePath = path.startsWith("/workspaces");

        if (!onboardingPath && !workspacePath) {
          window.location.replace("/onboarding/profile");
          return;
        }

        if (authPath) {
          window.location.replace("/onboarding/profile");
          return;
        }
      }

      setReady(true);
    }

    void syncAuth();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, orgLoaded, organization, getToken]);

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
      signInForceRedirectUrl="/home"
      signInFallbackRedirectUrl="/home"
      signUpForceRedirectUrl="/onboarding/profile"
      signUpFallbackRedirectUrl="/onboarding/profile"
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
