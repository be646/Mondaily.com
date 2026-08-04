import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB = join(__dirname, "../../../../apps/web/app");

function pages(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (e === "page.tsx" || e === "layout.tsx") out.push(p);
  }
  return out;
}

/**
 * The brand belongs in the title exactly once.
 *
 * The root layout sets `template: "%s · Mondaily"`, and eight pages ALSO baked "— Mondaily" into
 * their own title. Live result: "API Docs — Mondaily · Mondaily" in the browser tab and in every
 * search result. Fixed at the pages, not the template, so the brand is declared in one place.
 */
describe("page titles carry the brand once", () => {
  it("no page repeats the brand its template already appends", () => {
    const offenders: string[] = [];
    for (const f of pages(WEB)) {
      const src = readFileSync(f, "utf8");
      // the page's own metadata title — openGraph/twitter blocks legitimately spell it out
      const m = src.match(/\n {2}title: "([^"]*)"/);
      if (m && /mondaily/i.test(m[1]!)) offenders.push(`${f.slice(WEB.length + 1)} → "${m[1]}"`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the template that supplies it still exists", () => {
    // If this ever goes, the titles lose the brand entirely rather than doubling it.
    expect(readFileSync(join(WEB, "layout.tsx"), "utf8"))
      .toMatch(/template: "%s · Mondaily"/);
  });
});
