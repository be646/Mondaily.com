import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../../../apps/app/src");
const files: string[] = [];
(function walk(d: string) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) files.push(p);
  }
})(join(SRC, "routes"));
(function walk(d: string) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".tsx")) files.push(p);
  }
})(join(SRC, "components"));

const all = files.map(f => readFileSync(f, "utf8")).join("\n");
const count = (re: RegExp) => (all.match(re) ?? []).length;

/**
 * RATCHETS, not rewrites.
 *
 * Measured 2026-08-04: 2,380 arbitrary `text-[Npx]` classes across 131 files, and 962 hardcoded
 * uses of the four status hexes. Both look like inconsistency and mostly are not worth fixing:
 *
 *  - The status hexes are IDENTICAL to --status-* and those tokens are defined once in :root and
 *    never overridden per theme, so swapping them changes nothing a user can see.
 *  - The pixel sizes are tracked as DELIBERATELY DEFERRED by the design-system suite, which has
 *    explicit "deferred text-[13px] remain" assertions.
 *
 * Rewriting ~3,300 call sites for zero visible benefit is churn with real regression risk. What is
 * worth guarding is GROWTH: the debt is bounded today and must not quietly expand. If a number here
 * needs raising, that is a decision someone should have to make on purpose.
 */
describe("design debt is capped where it stands", () => {
  it("the ratchet is actually reading the app", () => {
    // Every assertion here is a CEILING, and a ceiling is satisfied by finding nothing. If the walk
    // broke or the app moved, all of these would report zero debt and pass — permanently green
    // while measuring an empty string. The floors are on what was READ, not on what was found, so
    // legitimately paying the debt down can never trip them.
    // Measured 2026-08-11: 196 files, ~3.4M characters.
    expect(files.length, "no source files walked — this ratchet is measuring nothing").toBeGreaterThan(100);
    expect(all.length, "source read but empty — the ratchet cannot see any code").toBeGreaterThan(500_000);
  });

  it("arbitrary pixel type sizes do not grow", () => {
    expect(count(/text-\[[0-9.]+px\]/g),
      "new arbitrary text sizes — use the type scale (text-caption/label/body/row/display)")
      .toBeLessThanOrEqual(2380);
  });

  it("hardcoded status hexes do not grow", () => {
    expect(count(/#(2f9e6b|c6892e|d1524a|717784)/gi),
      "new hardcoded status colours — use var(--status-ok|warn|bad|neutral)")
      .toBeLessThanOrEqual(962);
  });

  it("arbitrary radii stay effectively absent", () => {
    // 4 today, all deliberate one-offs. The scale is rounded-sm/md/lg/full.
    expect(count(/rounded-\[[0-9]+px\]/g), "use the radius scale").toBeLessThanOrEqual(4);
  });

  it("the tokens these replace actually exist", () => {
    // A ratchet pointing at a token that is not defined would be advice nobody can follow.
    const css = readFileSync(join(SRC, "styles.css"), "utf8");
    for (const t of ["--status-ok", "--status-warn", "--status-neutral"]) expect(css).toContain(t);
    for (const c of ["text-caption", "text-label", "text-body", "text-row"]) expect(css).toContain(c);
  });
});
