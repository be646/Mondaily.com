import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zValidator, describeZodError } from "../lib/validate";

const ROUTES = join(__dirname, "../routes");

/**
 * A failed validation must answer with a STRING under `error`, like every hand-written failure in
 * this API.
 *
 * @hono/zod-validator's default body is `{"success":false,"error":<the ZodError>}` — an OBJECT with
 * keys {issues, name}. The app put that straight into an alert banner, React refused to render an
 * object as a child (error #31) and unmounted the tree, so one mistyped field took the whole page
 * down. Measured in production 2026-08-11: 5 occurrences on /calendar, and "many pages" because
 * every failed mutation routes through that one banner.
 */
describe("failed validation answers with a readable string", () => {
  const app = new Hono()
    .post("/thing", zValidator("json", z.object({ title: z.string(), count: z.number() })), c => c.json({ ok: true }));

  it("returns { error: <string> }, never a ZodError object", async () => {
    const res = await app.request("/thing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: "not a number" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: unknown };
    expect(typeof body.error).toBe("string");
    // The exact shape that crashed the app must not come back.
    expect(body).not.toHaveProperty("error.issues");
    expect(body).not.toHaveProperty("success");
  });

  it("names the offending fields, because that is what makes it actionable", async () => {
    const res = await app.request("/thing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json() as { error: string };
    expect(body.error).toContain("title");
    expect(body.error).toContain("count");
  });

  it("still passes a valid body through untouched", async () => {
    const res = await app.request("/thing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "ok", count: 1 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("bounds the message so a large payload cannot flood a banner", () => {
    const many = z.object(Object.fromEntries([..."abcdefghij"].map(k => [k, z.string()])));
    const parsed = many.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const msg = describeZodError(parsed.error);
    expect(msg.split(";").length).toBeLessThanOrEqual(3);
  });

  it("never returns an empty string, even with no issues to report", () => {
    expect(describeZodError({ issues: [] } as unknown as Parameters<typeof describeZodError>[0]))
      .toBe("Invalid request body.");
  });

  /**
   * The fix is worth nothing if a route imports the raw package instead — that is the same "a rule
   * at one call site is not a rule" failure this wrapper exists to avoid. 171 call sites across 42
   * files get the hook by importing from lib/validate; this keeps it that way.
   */
  it("no route imports zValidator from the raw package", () => {
    const files: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    })(ROUTES);
    // Anti-vacuity: a broken walk would find no offenders and pass.
    expect(files.length, "no route files scanned — this guard is checking nothing").toBeGreaterThan(30);

    const offenders = files.filter(f => readFileSync(f, "utf8").includes("@hono/zod-validator"));
    expect(offenders.map(f => f.slice(ROUTES.length + 1)),
      "these routes bypass the error hook and will answer with a raw ZodError object, which crashes the app's alert banner",
    ).toEqual([]);
  });
});
