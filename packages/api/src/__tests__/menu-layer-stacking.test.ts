import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The portalled menu layer must outrank every overlay in the app.
 *
 * A popover is only ever opened from the surface that is already on top, so it has to paint above
 * all of them. It did not: the shared MenuSelect portalled at z-index 60 while the ticket drawer
 * sits at 201, so the status dropdown rendered correctly — right position, right size, visible,
 * opacity 1 — and was painted over by the drawer that owned it. The chevron flipped to "open" and
 * nothing appeared, which reads as a dead control rather than a hidden one.
 *
 * This re-derives the maximum z-index from the source on every run rather than pinning a number,
 * because the failure mode is someone adding a NEW overlay above the menu layer months from now.
 * A pinned number would still pass while every dropdown inside that overlay broke.
 */
const APP_SRC = join(__dirname, "../../../../apps/app/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("portalled menu stacking", () => {
  const files = walk(APP_SRC);

  const menuZ = (() => {
    const src = readFileSync(join(APP_SRC, "components/ui/controls.tsx"), "utf8");
    const m = /export const MENU_LAYER_Z = (\d+)/.exec(src);
    return m ? Number(m[1]) : NaN;
  })();

  it("declares the menu layer as one named constant", () => {
    // Not an inline number: the whole point is that there is a single place to reason about it.
    expect(Number.isFinite(menuZ)).toBe(true);
    const controls = readFileSync(join(APP_SRC, "components/ui/controls.tsx"), "utf8");
    expect(controls).toMatch(/zIndex: MENU_LAYER_Z/);
  });

  it("outranks every overlay in the app", () => {
    const offenders: { file: string; z: number }[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Tailwind arbitrary z-[N] and plain zIndex: N — the two ways overlays are written here.
      for (const m of src.matchAll(/z-\[(\d{2,})\]|zIndex:\s*(\d{2,})/g)) {
        const z = Number(m[1] ?? m[2]);
        // The constant's own declaration and use are not overlays.
        if (z === menuZ) continue;
        if (z > menuZ) offenders.push({ file: f.replace(APP_SRC, ""), z });
      }
    }
    expect(offenders, `overlays above the menu layer (${menuZ}) — dropdowns inside these are invisible: ${JSON.stringify(offenders)}`).toEqual([]);
  });
});
