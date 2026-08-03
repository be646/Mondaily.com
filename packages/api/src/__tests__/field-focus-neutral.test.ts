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

describe("the sheet's cell cursor is neutral", () => {
  const sheet = readFileSync(
    join(__dirname, "../../../../apps/app/src/components/records/record-table.tsx"), "utf8");

  it("the selected cell ring does not use the section accent", () => {
    // Reported from a screenshot: clicking any cell drew a bright green frame — the loudest thing
    // on a screen of quiet rows, for the least interesting fact (where the cursor is).
    const m = sheet.match(/boxShadow:\s*"inset 0 0 0 2px [^"]+"/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/--section-accent/);
  });

  it("the inline cell editor matches the cursor rather than recolouring it", () => {
    // Typing into a cell should change its affordance, not its colour.
    const m = sheet.match(/-mx-1 w-full min-w-0 rounded-sm border border-\[var\(--[a-z-]+\)\]/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toMatch(/section-accent/);
  });
});


describe("every anchored dropdown wears the same skin", () => {
  const files = [
    "apps/app/src/components/records/record-table.tsx",
    "apps/app/src/routes/dashboard/notes.tsx",
    "apps/app/src/routes/dashboard/lists/[listId].tsx",
  ];

  it("no anchored panel hand-rolls its own surface", () => {
    // Four different surfaces were in use for ONE concept — surface-card, surface-modal,
    // surface-hover and the canonical .ui-menu — and only two of ~25 panels carried a shadow, so
    // menus sat flat on the page in some places and floated in others. .ui-menu owns the surface,
    // the 4px radius and the shadow in one place.
    for (const f of files) {
      const src = readFileSync(join(__dirname, "../../../..", f), "utf8");
      const panels = src.match(/className="[^"]*absolute[^"]*(?:top-full|mt-1|mt-2)[^"]*"/g) ?? [];
      for (const p of panels) {
        if (/bg-\[var\(--surface-card\)\]|surface-modal/.test(p)) {
          expect(p, `${f}: hand-rolled panel surface`).toMatch(/ui-menu/);
        }
      }
    }
  });
});

describe("hover on secondary chrome is neutral", () => {
  it("secondary and ghost buttons do not border in the accent on hover", () => {
    // Reported twice. The accent is green on Deals, so every secondary button in a toolbar lit up
    // green under the cursor — colour spent on "the pointer is here".
    for (const re of [/\.btn-secondary:hover:not\(:disabled\)\s*\{[^}]*\}/,
                      /\.ui-btn:hover:not\(:disabled\)\s*\{[^}]*\}/]) {
      const m = css.match(re);
      expect(m, `missing ${re}`).toBeTruthy();
      expect(m![0], m![0]).not.toMatch(/--section-accent/);
    }
  });

  it("the PRIMARY button keeps its accent — that one is meant to be coloured", () => {
    // Quieting chrome must not flatten the one control that carries emphasis.
    const m = css.match(/\.ui-btn--primary:hover:not\(:disabled\)\s*\{[^}]*\}/);
    expect(m![0]).toMatch(/--section-accent/);
  });
});

