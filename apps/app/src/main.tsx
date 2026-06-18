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
    if (!isLoaded) return;
    if (!isSignedIn) {
      localStorage.removeItem("mondaily_session_token");
      localStorage.removeItem("mondaily_workspace_id");
      setTokenProvider(() => Promise.resolve(null));
      setReady(true);
      return;
    }
    // Wait for org to load before deciding workspace
    if (!orgLoaded) return;
    setTokenProvider(() => getToken());
    // Use the user's active Clerk organization as workspace ID.
    // Never fall back to a hardcoded ID — that would expose another user's data.
    if (organization?.id) {
      localStorage.setItem("mondaily_workspace_id", organization.id);
    } else {
      localStorage.removeItem("mondaily_workspace_id");
    }
    setReady(true);
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
