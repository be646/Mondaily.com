import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ClerkProvider, useAuth, useOrganization } from "@clerk/react";
import { useEffect } from "react";
import { App } from "./App";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false }
  }
});

function SessionBridge() {
  const { getToken, isSignedIn } = useAuth();
  const { organization } = useOrganization();
  useEffect(() => {
    if (!isSignedIn) {
      localStorage.removeItem("mondaily_session_token");
      return;
    }
    void getToken().then((token) => {
      if (token) localStorage.setItem("mondaily_session_token", token);
    });
  }, [getToken, isSignedIn]);
  useEffect(() => {
    if (organization?.id) localStorage.setItem("mondaily_workspace_id", organization.id);
  }, [organization?.id]);
  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <SessionBridge />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>
);
