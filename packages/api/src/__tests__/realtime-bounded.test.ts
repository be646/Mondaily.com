import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Realtime is a latency enhancement only — every consumer polls independently. When the Supabase
 * realtime WS can't connect (e.g. the prod anon key isn't accepted), the app must fail QUIETLY: try
 * a bounded number of times, mark itself down, tear the socket down, and keep polling — never spam the
 * console, never show a fake "live" state, and self-heal once the env is fixed.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const table = read("../../../../apps/app/src/hooks/useTableRealtime.ts");
const jobs = read("../../../../apps/app/src/hooks/useAgentJobsRealtime.ts");

describe("realtime — bounded, quiet, self-healing; polling always survives", () => {
  it("both hooks gate on realtimeDown() BEFORE opening a socket (no doomed reconnect loop)", () => {
    expect(table).toMatch(/if \(realtimeDown\(\)\) return;/);
    expect(jobs).toMatch(/if \(realtimeDown\(\)\) return;/);
    // The reconnect timer is pushed effectively to never — supabase-js won't auto-retry a dead socket.
    expect(table).toMatch(/reconnectAfterMs: \(\) => 1_000_000/);
    expect(jobs).toMatch(/reconnectAfterMs: \(\) => 1_000_000/);
  });
  it("a WS/channel failure marks down + disconnects (stops the native console spam)", () => {
    for (const src of [table, jobs]) {
      expect(src).toMatch(/if \(status === "CHANNEL_ERROR" \|\| status === "TIMED_OUT"\)/);
      expect(src).toMatch(/markRealtimeDown\(\);/);
      expect(src).toMatch(/client\.realtime\.disconnect\(\);/);
    }
  });
  it("the down flag is TTL-bounded (quiet across tabs/reloads) and self-heals after expiry", () => {
    // Persisted with an expiry so it survives new tabs/reloads within the window (→ at most one native
    // WS error per TTL per browser), but expires so a later mount re-probes (recovers, no code change).
    expect(table).toMatch(/const RT_DOWN_TTL_MS = 60 \* 60 \* 1000/);
    expect(table).toMatch(/localStorage\.setItem\(RT_DOWN_KEY, String\(Date\.now\(\) \+ RT_DOWN_TTL_MS\)\)/);
    expect(table).toMatch(/if \(Number\.isFinite\(until\) && Date\.now\(\) < until\)/);
    expect(table).toMatch(/localStorage\.removeItem\(RT_DOWN_KEY\);/); // expired → allow a fresh probe
  });
  it("realtime stays OPTIONAL — token-endpoint disabled/absent is a silent no-op (polling continues)", () => {
    // If the bridge isn't configured the hook returns early; it never throws, never blocks the caller.
    for (const src of [table, jobs]) {
      expect(src).toMatch(/!cfg\?\.enabled \|\| !cfg\.url \|\| !cfg\.anonKey \|\| !cfg\.token \|\| !cfg\.workspaceId/);
      expect(src).toMatch(/\.catch\(\(\) => null\)/); // token fetch failure is swallowed, not thrown
    }
  });
  it("never asserts a fake live state — `live.current` is true ONLY on a real SUBSCRIBED status", () => {
    for (const src of [table, jobs]) {
      expect(src).toMatch(/if \(status === "SUBSCRIBED"\) \{ live\.current = true;/);
      // down/error path explicitly sets it false — no optimistic "live" flip.
      expect(src).toMatch(/live\.current = false;/);
    }
  });
});
