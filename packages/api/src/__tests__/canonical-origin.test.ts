import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(__dirname, "../../../../apps/web");
const read = (p: string) => readFileSync(join(WEB, p), "utf8");

/**
 * The canonical URL must be one the site actually serves.
 *
 * layout.tsx, sitemap.ts and robots.ts each declared `https://mondaily.com` while Vercel serves
 * `https://www.mondaily.com` and 308-redirects the apex. Every canonical link, og:url and sitemap
 * entry therefore pointed at a URL that immediately redirects — and a self-referencing canonical
 * should resolve 200, since it is the URL you are asserting is authoritative.
 */
describe("one canonical origin", () => {
  it("is declared once, not copied into three files", () => {
    // Three copies is how they drift apart in the first place.
    for (const f of ["app/layout.tsx", "app/sitemap.ts", "app/robots.ts"]) {
      expect(read(f), f).toMatch(/from "@\/lib\/site-url"/);
      expect(read(f), f).not.toMatch(/const SITE = "https:/);
    }
  });

  it("defaults to the host that actually serves, and is overridable", () => {
    // If the Vercel primary domain is flipped to the apex, NEXT_PUBLIC_SITE_URL follows it with no
    // other change — the rest of the codebase's intent suggests apex was the plan.
    const src = read("lib/site-url.ts");
    expect(src).toMatch(/process\.env\.NEXT_PUBLIC_SITE_URL/);
    expect(src).toMatch(/https:\/\/www\.mondaily\.com/);
    expect(src).toMatch(/replace\(\/\\\/\+\$\/, ""\)/);   // no trailing slash → no "//pricing"
  });
});
