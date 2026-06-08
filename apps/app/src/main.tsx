import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider, useAuth, useOrganization } from "@clerk/react";
import { useEffect, useState } from "react";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false }
  }
});

function AppWithAuth() {
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
      const wsId = organization?.id || '8ccef088-6493-4cd9-a0cf-3214098f59a1';
      localStorage.setItem("mondaily_workspace_id", wsId);
      setReady(true);
    });
  }, [isLoaded, isSignedIn, getToken, organization?.id]);

  useEffect(() => {
    if (!isSignedIn || !isLoaded) return;
    const interval = setInterval(() => {
      getToken().then((token) => {
        if (token) localStorage.setItem("mondaily_session_token", token);
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, [isSignedIn, isLoaded, getToken]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <AppWithAuth />
    </ClerkProvider>
  </React.StrictMode>
);
