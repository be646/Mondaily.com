import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import * as store from "../lib/rate-limit-store";

/**
 * Sliding-window rate limiter for auth endpoints. Keyed by route + client IP + (when present)
 * the request's email, so brute-forcing one account or hammering from one IP both trip the
 * limit. Default: >5 attempts in 60s → HTTP 429 with Retry-After.
 *
 * DURABLE FIRST, in-memory as fallback. The in-memory window is per warm serverless instance, which
 * on Vercel means it barely exists: measured against production on 2026-08-04, fifteen rapid
 * requests to a 12-per-minute endpoint all returned 200 because each landed on a different
 * instance. The counter now lives in Postgres (our own — see lib/rate-limit-store), so the window
 * is global.
 *
 * If that table is missing or the database blips, the store returns null and this falls back to the
 * in-memory bucket rather than locking everyone out. A limiter that takes the product down when its
 * own table is absent is a worse outage than the abuse it prevents.
 */
const WINDOW_MS = 60_000;
const MAX = 5;
const buckets = new Map<string, number[]>();

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unknown";
}

export function rateLimit(opts?: { max?: number; windowMs?: number }) {
  const max = opts?.max ?? MAX;
  const windowMs = opts?.windowMs ?? WINDOW_MS;
  return createMiddleware(async (c, next) => {
    let email = "";
    try { const b = await c.req.json(); email = String((b as { email?: string })?.email ?? "").toLowerCase(); } catch { /* no/!json body */ }
    const key = `${c.req.path}|${clientIp(c)}|${email}`;
    const now = Date.now();

    // Global count first. `null` means the durable store is unavailable — fall through.
    const durable = await store.hit(key, windowMs);
    if (durable) {
      if (durable.lockedForSecs > 0) {
        c.header("Retry-After", String(durable.lockedForSecs));
        throw new HTTPException(429, { message: `Too many attempts. Please wait ${durable.lockedForSecs}s and try again.` });
      }
      if (durable.hits > max) {
        const retry = Math.max(1, Math.ceil(windowMs / 1000));
        c.header("Retry-After", String(retry));
        throw new HTTPException(429, { message: `Too many attempts. Please wait ${retry}s and try again.` });
      }
      await next();
      return;
    }

    const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs);

    if (hits.length >= max) {
      const retry = Math.max(1, Math.ceil((windowMs - (now - hits[0]!)) / 1000));
      c.header("Retry-After", String(retry));
      throw new HTTPException(429, { message: `Too many attempts. Please wait ${retry}s and try again.` });
    }

    hits.push(now);
    buckets.set(key, hits);
    // Bound memory: occasionally drop stale buckets.
    if (buckets.size > 10_000) {
      for (const [k, ts] of buckets) {
        if (ts.every(t => now - t >= windowMs)) buckets.delete(k);
      }
    }
    await next();
  });
}
