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

  it("removed the border override only after its last site was migrated", () => {
    // Order matters: the six auth screens moved onto --border-soft FIRST, and the rule went once
    // nothing carried border-zinc-700/800 any more.
    expect(allTsx()).not.toMatch(/border-zinc-[78]00/);
    expect(css()).not.toMatch(/\[class\*="border-zinc-8"\]/);
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

describe("the light-mode override net is gone, because it never ran", () => {
  it("no !important override is scoped to a theme id that does not exist", () => {
    // MEASURED: the four theme ids are console, paper, daylight and rose. Every rule in the old
    // net was scoped to html[data-theme="light"], so none of them ever matched an element in
    // production. That is also why components kept accumulating hardcoded colours that "the net
    // would handle" — it never handled anything.
    const src = css();
    // Selector USE, not the words: the notes left behind name the selector to explain its removal.
    expect(src).not.toMatch(/html\[data-theme="light"\]\s*[.[]/);
    expect(src).not.toMatch(/html\[data-theme="light"\]\s*\{/);
  });

  it("light is a TOKEN SCOPE, and works on any element, not just <html>", () => {
    // The onboarding layout forces a light context on a div. As an html-only scope it inherited
    // nothing, so that intent silently did nothing.
    expect(css()).toMatch(/html\[data-theme="daylight"\], \[data-theme="light"\] \{/);
    expect(read("apps/app/src/routes/onboarding/onboarding-layout.tsx")).toMatch(/data-theme="light"/);
  });

  it("the light scrollbar keys off the REAL light theme ids", () => {
    // It was html[data-theme="light"]-only, so daylight/paper/rose got a dark thumb on a white sheet.
    const src = css();
    expect(src).toMatch(/html\[data-theme="daylight"\] \.record-scroll::-webkit-scrollbar-thumb/);
    expect(src).toMatch(/html\[data-theme="rose"\] \.record-scroll/);
  });

  it("the override count came down, and what remains is not theme-scoped dead weight", () => {
    expect((css().match(/!important/g) ?? []).length).toBeLessThanOrEqual(13);
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
