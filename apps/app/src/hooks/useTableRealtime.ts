import { useEffect, useRef } from "react";
import { apiClient } from "../lib/api-client";

/**
 * Generic workspace-scoped Supabase Realtime subscription. Fetches a short-lived Supabase
 * JWT from our API (/realtime/token), then opens a postgres_changes channel on `table`
 * filtered to the caller's workspace. Every matching insert/update/delete fires `onChange`
 * (the caller invalidates its query → instant update).
 *
 * GRACEFUL: if the realtime bridge isn't configured (token endpoint returns { enabled:false })
 * or the table isn't in the supabase_realtime publication, this is a no-op and the caller's
 * polling keeps working — nothing breaks. supabase-js is imported lazily.
 *
 * @returns a ref whose `.current` is true once the live channel is subscribed (callers can
 *          use it to relax their polling interval while live).
 */
export function useTableRealtime(table: string, onChange: () => void): { current: boolean } {
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
        .channel(`${table}:${cfg.workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `workspace_id=eq.${cfg.workspaceId}` },
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
  }, [table]);

  return live;
}
