import { zValidator as baseValidator } from "@hono/zod-validator";
import type { ZodError } from "zod";

/**
 * `zValidator`, but answering a failed validation with a SENTENCE instead of a raw ZodError.
 *
 * @hono/zod-validator's default 400 body is `{"success":false,"error":<the ZodError>}` — so `error`
 * is an OBJECT with keys `{issues, name}`, not a string. Two problems with shipping that:
 *
 *  1. It CRASHED THE APP. The client puts `body.error` into an alert banner, React refused to render
 *     an object as a child (error #31), and the tree unmounted — so a mistyped field took the whole
 *     page down. Measured in production 2026-08-11: 5 occurrences on /calendar, and "many pages"
 *     because every failed mutation routes through the same banner. The client is now hardened too
 *     (apps/app/src/lib/alerts.ts), but a client fix alone leaves the bad shape on the wire for
 *     every other consumer — the MCP server, the e2e suite, anyone integrating.
 *  2. It leaks internal schema shape — field paths, expected types, our zod structure — to any
 *     caller who sends a bad body, which is free reconnaissance.
 *
 * `error` is now always a string, matching what every hand-written failure in this API already
 * returns (`c.json({ error: "…" }, 400)`), so a client can rely on ONE shape. The field paths are
 * kept in the message because "title: Required" is what makes the error actionable; that is the
 * same information a caller gets by reading our public schema, not a secret.
 *
 * Applied by importing from here rather than from the package — 171 call sites across 42 route
 * files get it without touching any of them. A rule at one call site is not a rule.
 */

/** "title: Required; starts_at: Expected string" — bounded, so a huge payload cannot flood a banner. */
export function describeZodError(error: ZodError): string {
  const parts = error.issues
    .map(issue => {
      const field = issue.path.filter(p => p !== undefined).join(".");
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .filter(Boolean);
  return parts.length ? parts.slice(0, 3).join("; ") : "Invalid request body.";
}

// The cast preserves zValidator's full generic signature so every call site keeps its inferred
// request types — the wrapper only injects the error hook. Typing the parameters concretely here
// would collapse that inference and break all 171 call sites.
export const zValidator = ((target: Parameters<typeof baseValidator>[0], schema: Parameters<typeof baseValidator>[1]) =>
  baseValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: describeZodError(result.error as ZodError) }, 400);
    }
    return undefined;
  })) as typeof baseValidator;
