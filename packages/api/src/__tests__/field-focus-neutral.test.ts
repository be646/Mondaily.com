import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "../../../../apps/app/src/styles.css"), "utf8");

/**
 * Focus on a form field is NEUTRAL.
 *
 * The section accent is green on Deals, so clicking any field threw a coloured frame plus a 2px
 * glow around it. This was reported twice: the first fix changed the card's hover border in the
 * .tsx and MISSED the real rules, which live in styles.css and are deliberately unlayered so they
 * beat Tailwind. Same lesson as the .ask-input sizing miss — sweeping class names in .tsx is not
 * sweeping the stylesheet.
 */
describe("form fields do not focus in the section accent", () => {
  const blocks = [
    /select:focus-visible\s*\{[^}]*\}/,
    /\.key-input:focus\s*\{[^}]*\}/,
    /select\.ui-select:focus,\s*select\.key-input:focus\s*\{[^}]*\}/,
  ];

  it("every field focus rule uses a neutral border and ring", () => {
    for (const re of blocks) {
      const m = css.match(re);
      expect(m, `missing rule ${re}`).toBeTruthy();
      expect(m![0], m![0]).not.toMatch(/--section-accent/);
    }
  });

  it("focus is still VISIBLE — quieting it must not remove it", () => {
    // A field that shows nothing on focus is worse than one that shouts.
    for (const re of blocks) {
      const m = css.match(re)!;
      expect(m[0]).toMatch(/border-color:\s*var\(--border-strong\)/);
      expect(m[0]).toMatch(/box-shadow:\s*0 0 0 2px/);
    }
  });

  it("the accent is kept where it carries meaning", () => {
    // The Ask composer's signature ring is intentional and stays.
    expect(css).toMatch(/\.ask-input:focus-within\s*\{[^}]*--section-accent/);
  });
});
