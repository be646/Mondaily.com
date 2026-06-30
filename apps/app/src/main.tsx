import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { SovereignAuthProvider, useSovereignAuth } from "./components/auth/sovereign-auth-context";
import { queryClient } from "./lib/query-client";
import { applyTheme, getTheme } from "./lib/theme";
import "./styles.css";

/**
 * Root gate — readiness comes entirely from our native cookie session. Nothing renders until
 * the SovereignAuthProvider has resolved /me (and the workspace it persists). Clerk is gone.
 */
function SovereignGate({ children }: { children: React.ReactNode }) {
  const { status } = useSovereignAuth();
  if (status === "loading") return null;
  return <>{children}</>;
}

// Apply saved theme before first render to avoid flash
(function initTheme() {
  // One-time migration: Console (jet black) is the default aesthetic — reset existing devices once.
  if (!localStorage.getItem("mondaily_theme_dark_reset")) {
    localStorage.setItem("mondaily_appearance", "console");
    localStorage.setItem("mondaily_theme_dark_reset", "1");
  }
  applyTheme(getTheme());
  // Primary-button colour: "dark" (default) or "accent" (sage green)
  const btn = localStorage.getItem("mondaily_btnstyle");
  if (btn === "accent") document.documentElement.dataset.btnstyle = "accent";
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SovereignAuthProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SovereignGate>
            <App />
          </SovereignGate>
        </BrowserRouter>
      </QueryClientProvider>
    </SovereignAuthProvider>
  </React.StrictMode>
);
