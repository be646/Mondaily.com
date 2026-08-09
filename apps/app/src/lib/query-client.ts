import { MutationCache, QueryClient } from "@tanstack/react-query";
import { alertError, describeError } from "./alerts";

/**
 * The single app-wide react-query client. Exported as a module singleton so the auth layer can
 * call `queryClient.clear()` on every account switch (login/register/logout) — without this, an
 * in-SPA account change keeps the PREVIOUS user's cached `/home`, `/workspaces/mine`, tasks, etc.
 * in memory, which is what made a brand-new account briefly show another workspace's metrics.
 */
export const queryClient = new QueryClient({
  /**
   * EVERY unhandled mutation failure becomes visible, in one place.
   *
   * Measured across settings on 2026-08-05: 49 mutations, 11 with an onError, 3 reading isError.
   * The other 38 failed silently — a toggle flipped, the request 500'd, and the user was told
   * nothing. A save that quietly did not save is worse than an error, because the user walks away
   * believing the opposite of what is true.
   *
   * Fixing that per call site would be 38 edits that the 39th mutation immediately escapes. This is
   * the same lesson as the close-date stamping and the sovereign mail relay: a rule applied at one
   * call site is not a rule. A default at the cache catches everything written from today, and a
   * mutation that DOES define its own onError still wins — react-query calls this in addition to
   * the local handler, so this is a floor, not an override.
   */
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      // Opt out with `meta: { silent: true }` for mutations whose failure is genuinely not worth
      // interrupting anyone over (background polls, best-effort telemetry).
      if (mutation.options.meta?.silent) return;
      alertError("That didn't save", describeError(error));
    },
  }),
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
  },
});
