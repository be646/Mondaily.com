import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = () => read("apps/app/src/styles.css");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) tsxFiles(rel, out);
    else if (e.endsWith(".tsx")) out.push(rel);
  }
  return out;
}
const allTsx = () => tsxFiles("apps/app/src").map(read).join("\n");

/**
 * Design pass 2. The rule applied throughout: a CSS net is deleted only once MEASURED to match
 * nothing, or once the sites it covered are migrated. Nothing was removed on the theory that it
 * looked unnecessary.
 */
describe("dead overrides are gone, and only the dead ones", () => {
  it("no longer forces the retired dark hex backgrounds", () => {
    const src = css();
    for (const hex of ["0b0d10", "0d0f13", "0f1114", "0f1115", "121214", "111419", "13151a", "1a1118"]) {
      expect(src).not.toMatch(new RegExp(`\\[class\\*="bg-\\[#${hex}\\]"\\]`));
    }
  });

  it("no component reintroduced them", () => {
    expect(allTsx()).not.toMatch(/bg-\[#(0b0d10|0d0f13|0f1114|0f1115|121214|111419|13151a|1a1118)\]/);
  });

  it("dropped the bracket-form bg-white overrides, and no component uses that form", () => {
    expect(css()).not.toMatch(/\[class\*="bg-white\/\[\.\d\d\]"\]/);
    expect(allTsx()).not.toMatch(/bg-white\/\[\./);
  });

  it("dropped the slate palette overrides — the palette is fully retired", () => {
    // The RULE, not the word — the note left in its place names the palette it removed.
    expect(css()).not.toMatch(/\[class\*="text-slate-\d"\]/);
    expect(allTsx()).not.toMatch(/\b(text|bg|border)-slate-\d/);
  });

  it("kept the overrides that still have live targets", () => {
    // Honesty check in the other direction: a net whose sites were NOT migrated must survive.
    expect(css()).toMatch(/\[class\*="border-zinc-8"\]/);
  });
});

describe("the sites the nets used to paper over were migrated to tokens", () => {
  it("the auth screens no longer hardcode a border colour", () => {
    for (const f of [
      "apps/app/src/components/auth/auth-shell.tsx",
      "apps/app/src/components/auth/mfa-card.tsx",
      "apps/app/src/routes/auth/shadow-login.tsx",
    ]) {
      expect(read(f)).not.toMatch(/border-zinc-[78]00/);
      expect(read(f)).toMatch(/border-\[var\(--border-soft\)\]/);
    }
  });

  it("muted text uses the token instead of three interchangeable zinc shades", () => {
    expect(allTsx()).not.toMatch(/text-zinc-(500|600|700)\b/);
  });
});

describe("white text on a coloured button stays white in light mode", () => {
  it("the override skips any element that paints its own background", () => {
    // Measured live: text-white on a #d1524a button computed to rgb(24,24,27) in light mode —
    // near-black on red, on destructive actions like Purge data and Leave call.
    expect(css()).toMatch(/\[class\*="text-white"\]:not\(\[class\*="bg-"\]\):not\(\[style\*="background"\]\)/);
  });
});

describe("there is one definition of the corner radius", () => {
  it("defines the scale as tokens", () => {
    const src = css();
    expect(src).toMatch(/--radius-sm:/);
    expect(src).toMatch(/--radius-md:/);
    expect(src).toMatch(/--radius-lg:/);
    expect(src).toMatch(/--radius-pill:/);
  });

  it("nothing sits outside the scale any more", () => {
    // The 45 outliers were folded into lg; rounded-full survives because pills, avatars and
    // status dots are circles by intent, not by drift.
    expect(allTsx()).not.toMatch(/\brounded-(xl|2xl|3xl)\b/);
    expect(allTsx()).toMatch(/rounded-full/);
  });

  it("text colours read from tokens, so they respond to the theme", () => {
    // Measured live: every text-stone-* shade computed to the SAME rgb in light and dark, i.e.
    // that text ignored the theme entirely. The map was built from nearest measured luminance.
    const src = allTsx();
    expect(src).not.toMatch(/text-(stone|zinc)-(50|100|200|300|400|500|600|700)\b/);
    // 800/900/950 deliberately survive: dark text on light chips, which a token would invert.
    expect(src).toMatch(/text-stone-950|text-zinc-900/);
  });
});

describe("the icon button is one button", () => {
  it("exists as a class", () => {
    expect(css()).toMatch(/\.btn-icon \{/);
    expect(css()).toMatch(/\.btn-icon:hover:not\(:disabled\)/);
  });

  it("the near-identical inline variants are gone", () => {
    const src = allTsx();
    expect(src).not.toMatch(/rounded-md p-1 text-stone-500 hover:bg-\[var\(--surface-hover\)\]/);
    expect(src).not.toMatch(/rounded-sm p-1 text-\[var\(--text-muted\)\] hover:bg-\[var\(--surface-hover\)\] hover:text-\[var\(--text-primary\)\]/);
  });
});
