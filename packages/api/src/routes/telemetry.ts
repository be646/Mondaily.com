import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createHash } from "node:crypto";
import { supabase } from "@mondaily/db/client";
import { rateLimit } from "../middleware/rate-limit";

/**
 * Where production errors go.
 *
 * Until now they went nowhere: the app's ErrorBoundary caught a render error, wrote console.error
 * into a browser nobody was watching, and showed a recovery card. Unless a user reported it, the
 * failure was invisible — which is how three of the defects found by audit on 2026-08-04 survived,
 * all of them silent and all of them looking like a 200 from outside.
 *
 * DELIBERATELY UNAUTHENTICATED. An error thrown before auth resolves — a bad session, a broken
 * bootstrap, a chunk that will not load — is exactly the class worth hearing about, and requiring a
 * session would drop precisely those. That makes it a public write endpoint, so it is bounded the
 * same way /public/ask had to be: rate limited per IP, every field length-capped, and deduped in
 * the database so one throwing component cannot flood the table.
 */
const router = new Hono<{ Variables: { userId?: string; workspaceId?: string } }>();

/** Group by WHAT broke, not by how many times — so a loop reports once with a count. */
function fingerprint(message: string, route: string, source: string): string {
  // Strip volatile parts so the same fault does not split into a thousand rows: uuids, numbers,
  // and quoted values differ per occurrence while being the same bug.
  const norm = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/'[^']*'|"[^"]*"/g, "<v>")
    .slice(0, 300);
  return createHash("sha256").update(`${source}|${route}|${norm}`).digest("hex").slice(0, 32);
}

router.post(
  "/error",
  rateLimit({ max: 30, windowMs: 60_000 }),
  zValidator("json", z.object({
    message: z.string().min(1).max(2_000),
    route: z.string().max(300).optional(),
    source: z.enum(["client", "api"]).default("client"),
    release: z.string().max(80).optional(),
  })),
  async (c) => {
    const { message, route, source, release } = c.req.valid("json");
    const fp = fingerprint(message, route ?? "", source);

    // The workspace is taken from the SESSION when one exists, never from the body — a public
    // endpoint that let callers attribute errors to someone else's workspace would be a way to
    // pollute another tenant's worklist.
    const workspaceId = c.get("workspaceId") ?? null;

    const { data, error } = await supabase.rpc("client_error_report", {
      p_fingerprint: fp,
      p_message: message,
      p_source: source,
      p_route: route ?? null,
      p_workspace: workspaceId,
      p_release: release ?? null,
      p_user_agent: c.req.header("user-agent")?.slice(0, 300) ?? null,
    });

    // FAIL SOFT, always. This endpoint exists to observe failures; it must never become one. If the
    // migration has not run, the report is dropped and the caller still gets a 202 — an app that
    // breaks harder because its error reporter is missing would be the worst possible outcome.
    if (error) console.error("[telemetry] could not record client error:", error.message);

    // Return the running count. Two reasons: a caller can tell a first occurrence from a recurrence
    // without another round trip, and — the reason it exists — dedup becomes VERIFIABLE from
    // outside. "recorded: true" twice proves the endpoint accepted twice, not that it collapsed
    // them into one row; an occurrence count that climbs while the row count does not is evidence.
    const row = Array.isArray(data) ? data[0] : data;
    const occurrences = Number((row as { out_occurrences?: number } | null)?.out_occurrences ?? 0) || null;
    return c.json({ recorded: !error, occurrences }, 202);
  },
);

export { router as telemetryRouter };
