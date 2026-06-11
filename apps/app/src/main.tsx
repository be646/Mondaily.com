import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider, useAuth, useOrganization } from "@clerk/react";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false }
  }
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { organization } = useOrganization();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      localStorage.removeItem("mondaily_session_token");
      setReady(true);
      return;
    }
    getToken().then((token) => {
      if (token) localStorage.setItem("mondaily_session_token", token);
      localStorage.setItem("mondaily_workspace_id", organization?.id || "8ccef088-6493-4cd9-a0cf-3214098f59a1");
      setReady(true);
    });
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !isLoaded) return;
    const interval = setInterval(() => {
      getToken().then((token) => {
        if (token) localStorage.setItem("mondaily_session_token", token);
      });
    }, 55_000);
    return () => clearInterval(interval);
  }, [isSignedIn, isLoaded]);

  useEffect(() => {
    if (organization?.id) {
      localStorage.setItem("mondaily_workspace_id", organization.id);
    }
  }, [organization?.id]);

  if (!ready) return null;
  return <>{children}</>;
}

// Apply saved theme before first render to avoid flash
(function applyTheme() {
  const saved = localStorage.getItem("mondaily_appearance") as "dark" | "light" | "system" | null;
  const mode = saved ?? "system";
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
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
