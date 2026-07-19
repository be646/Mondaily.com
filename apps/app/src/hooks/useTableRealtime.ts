import { useEffect, useRef } from "react";
import { apiClient } from "../lib/api-client";

// Bounded "realtime is down" flag. Once the Supabase realtime WS has failed (e.g. the deployment's anon
// apikey isn't accepted by the realtime endpoint), we stop reopening a doomed socket on every hook mount
// AND across new tabs/reloads for a while — so the browser's native "WebSocket connection failed" log
// (which JS can't suppress) appears at most ONCE per TTL window per browser, not once per tab. Realtime
// is only a latency enhancement — every consumer already polls — so this fails silently, never breaking
// notifications / unread / live updates and never showing a fake "live" state.
//
// It self-heals: the flag carries an expiry, so after RT_DOWN_TTL_MS the next mount probes again. If the
// env is later fixed the probe subscribes and the flag is simply never re-set — no code change needed.
const RT_DOWN_KEY = "mondaily_realtime_down";
const RT_DOWN_TTL_MS = 60 * 60 * 1000; // re-probe at most once per hour per browser
let rtDownMem = false;                  // in-memory fast path for the current tab (survives storage errors)

export const realtimeDown = () => {
  if (rtDownMem) return true;
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(RT_DOWN_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (Number.isFinite(until) && Date.now() < until) { rtDownMem = true; return true; }
    localStorage.removeItem(RT_DOWN_KEY);   // expired → allow one fresh probe (auto-recovers if env fixed)
    return false;
  } catch { return rtDownMem; }
};
export const markRealtimeDown = () => {
  rtDownMem = true;
  try { localStorage.setItem(RT_DOWN_KEY, String(Date.now() + RT_DOWN_TTL_MS)); } catch { /* ignore */ }
};

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
      if (realtimeDown()) return;   // already failed this session → poll silently, no doomed socket
      const cfg = await apiClient
        .get<{ enabled: boolean; token?: string; url?: string; anonKey?: string; workspaceId?: string }>("/realtime/token")
        .catch(() => null);
      if (cancelled || !cfg?.enabled || !cfg.url || !cfg.anonKey || !cfg.token || !cfg.workspaceId) return;

      const { createClient } = await import("@supabase/supabase-js");
      if (cancelled) return;
      client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 5 }, reconnectAfterMs: () => 1_000_000 },
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
        .subscribe((status: string) => {
          if (status === "SUBSCRIBED") { live.current = true; return; }
          // Bridge unavailable (WS rejected) → mark down for the session + tear the socket down so
          // supabase-js stops retrying and spamming the console. Polling stays the source of truth.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            live.current = false;
            markRealtimeDown();
            try { client.removeChannel(channel); } catch { /* ignore */ }
            try { client.realtime.disconnect(); } catch { /* ignore */ }
          }
        });
    })();

    return () => {
      cancelled = true;
      live.current = false;
      if (client && channel) client.removeChannel(channel);
    };
  }, [table]);

  return live;
}
