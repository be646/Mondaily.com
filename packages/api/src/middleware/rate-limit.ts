import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

/**
 * Sliding-window rate limiter for auth endpoints. Keyed by route + client IP + (when present)
 * the request's email, so brute-forcing one account or hammering from one IP both trip the
 * limit. Default: >5 attempts in 60s → HTTP 429 with Retry-After.
 *
 * NOTE: in-memory, so the window is per warm serverless instance — a solid first layer that
 * stops casual scripts. For a hard global limit across instances, back it with Redis/Postgres.
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
