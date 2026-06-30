import { QueryClient } from "@tanstack/react-query";

/**
 * The single app-wide react-query client. Exported as a module singleton so the auth layer can
 * call `queryClient.clear()` on every account switch (login/register/logout) — without this, an
 * in-SPA account change keeps the PREVIOUS user's cached `/home`, `/workspaces/mine`, tasks, etc.
 * in memory, which is what made a brand-new account briefly show another workspace's metrics.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});
