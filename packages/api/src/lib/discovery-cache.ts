import { supabase } from "@mondaily/db/client";
import { createHash } from "node:crypto";

/**
 * Discovery cache — memoizes search results + scraped pages so repeats/monitors/the coach don't
 * re-hit rate-limited engines or re-scrape. FAIL-OPEN: any DB error (incl. table not migrated yet)
 * just misses and the caller fetches fresh. Set DISCOVERY_CACHE_DISABLE=1 to turn it off.
 */
const enabled = () => process.env.DISCOVERY_CACHE_DISABLE !== "1";
const hash = (s: string) => createHash("md5").update(s).digest("hex");

export function cacheKey(kind: "search" | "scrape", raw: string): string {
  return `${kind}:${hash(raw)}`;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!enabled()) return null;
  try {
    const { data } = await supabase
      .from("discovery_cache")
      .select("value, expires_at")
      .eq("key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    return (data?.value as T) ?? null;
  } catch { return null; }
}

export async function cacheSet(key: string, kind: "search" | "scrape", value: unknown, ttlSeconds: number): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from("discovery_cache").upsert({
      key, kind, value,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
  } catch { /* fail-open */ }
}
