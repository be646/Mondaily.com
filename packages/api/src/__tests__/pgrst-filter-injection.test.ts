import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { orFilterValue } from "../lib/pgrst-filter";

/**
 * Values spliced into a PostgREST filter STRING must be neutralised first.
 *
 * `.or("a.eq.1,b.eq.2")` is a parsed expression, not bound parameters — so a caller-supplied value
 * containing a comma or parenthesis stops being an operand and becomes syntax.
 *
 * Not a tenant escape (the workspace `.eq()` ANDs with the whole expression), but it changes which
 * of that workspace's rows come back and hands an attacker a query-shaped error oracle.
 *
 * Audited every site on 2026-08-05: most interpolate `userId`/`me` from the VERIFIED SESSION, which
 * is server-derived and safe. search and mcp sanitise their own input. emails.ts spliced a raw path
 * param — that was the hole, and it is why this now lives in one shared helper instead of being
 * solved a fourth different way.
 */
const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (p.includes("__tests__")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Values that are safe by provenance: derived from the verified session, not the request body. */
const SESSION_DERIVED = /^\$\{(userId|me|scope\.userId|c\.get\("userId"\))\}$/;

describe("orFilterValue", () => {
  it("neutralises the expression metacharacters", () => {
    expect(orFilterValue("a,b(c)d")).toBe("a b c d");
    expect(orFilterValue("50%")).toBe("50");
  });

  it("caps length so a filter cannot be used as a payload channel", () => {
    expect(orFilterValue("x".repeat(5000)).length).toBe(200);
  });

  it("survives the shapes a real id takes", () => {
    const uuid = "6f1c2b8a-1111-4222-8333-444455556666";
    expect(orFilterValue(uuid)).toBe(uuid);
    expect(orFilterValue("mtd-3f9a2b")).toBe("mtd-3f9a2b");
  });

  it("cannot break out of the operand it is spliced into", () => {
    const attack = "x,workspace_id.neq.00000000-0000-0000-0000-000000000000";
    expect(orFilterValue(attack)).not.toContain(",");
  });
});

describe("no route splices unsanitised caller input into a filter string", () => {
  it("every interpolation is session-derived or passed through a sanitiser", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.(?:or|filter|not|in)\(`([^`]*)`\)/g)) {
        for (const v of (m[1] ?? "").matchAll(/\$\{[^}]+\}/g)) {
          const expr = v[0];
          if (SESSION_DERIVED.test(expr)) continue;
          // Sanitised AT the splice. Deliberately not accepting "a variable that was cleaned
          // two lines up" — that is exactly how emails.ts drifted, and a reviewer cannot see it.
          if (/orFilterValue\(/.test(expr)) continue;
          offenders.push(`${f.slice(SRC.length + 1)} → ${expr}`);
        }
      }
    }
    expect(offenders,
      `Caller-supplied values spliced raw into a PostgREST filter string. Wrap them in ` +
      `orFilterValue() from lib/pgrst-filter:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
