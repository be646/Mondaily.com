import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../../../../apps/app/src");
function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/**
 * A button whose only content is an icon has no accessible name unless one is given.
 *
 * A screen reader announces it as "button" — the user is told something is actionable but not what
 * it does. Measured 2026-08-04: 9 of 27 icon-only buttons had neither aria-label nor title,
 * including Save, Remove, Back and Continue.
 */
const ICON_ONLY = /<button[^>]*>\s*(?:\{[^}]*\}\s*)?<[A-Z]\w+ size=\{?\d+\}?[^>]*\/>\s*<\/button>/g;

describe("icon-only buttons have accessible names", () => {
  it("every icon-only button carries aria-label or title", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      for (const m of readFileSync(f, "utf8").matchAll(ICON_ONLY)) {
        const tag = m[0];
        if (!/aria-label|title=/.test(tag)) {
          offenders.push(`${f.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
        }
      }
    }
    expect(offenders, `icon-only buttons with no accessible name:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the names describe the ACTION, not the icon", () => {
    // "Save stage" tells you what happens; "Check" describes a glyph and helps nobody.
    const board = readFileSync(join(SRC, "components/records/board-view.tsx"), "utf8");
    expect(board).toMatch(/aria-label="Save stage"/);
    const table = readFileSync(join(SRC, "components/records/record-table.tsx"), "utf8");
    expect(table).toMatch(/aria-label="Save this view"/);
  });
});
