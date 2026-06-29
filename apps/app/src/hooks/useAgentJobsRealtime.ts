import { useEffect, useRef } from "react";
import { apiClient } from "../lib/api-client";

/**
 * True real-time for the agent ops center via Supabase Realtime, bridged from Clerk.
 * Fetches a short-lived Supabase JWT from our API (/realtime/token), then opens a
 * postgres_changes channel on agent_jobs scoped to the workspace. Every insert/update
 * fires `onChange` (the caller invalidates its query → instant feed update).
 *
 * GRACEFUL: if the bridge isn't configured (no SUPABASE_JWT_SECRET / ANON_KEY), the
 * token endpoint returns { enabled:false } and this hook is a no-op — the feed keeps
 * its adaptive polling, so nothing breaks. supabase-js is loaded lazily so it never
 * bloats the bundle for users without realtime configured.
 *
 * @returns a ref whose `.current` is true once the live channel is subscribed.
 */
export function useAgentJobsRealtime(onChange: () => void): { current: boolean } {
  const live = useRef(false);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;

    (async () => {
      const cfg = await apiClient
        .get<{ enabled: boolean; token?: string; url?: string; anonKey?: string; workspaceId?: string }>("/realtime/token")
        .catch(() => null);
      if (cancelled || !cfg?.enabled || !cfg.url || !cfg.anonKey || !cfg.token || !cfg.workspaceId) return;

      const { createClient } = await import("@supabase/supabase-js");
      if (cancelled) return;
      client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });
      client.realtime.setAuth(cfg.token);
      channel = client
        .channel(`agent_jobs:${cfg.workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "agent_jobs", filter: `workspace_id=eq.${cfg.workspaceId}` },
          () => cb.current(),
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .subscribe((status: string) => { if (status === "SUBSCRIBED") live.current = true; });
    })();

    return () => {
      cancelled = true;
      live.current = false;
      if (client && channel) client.removeChannel(channel);
    };
  }, []);

  return live;
}
