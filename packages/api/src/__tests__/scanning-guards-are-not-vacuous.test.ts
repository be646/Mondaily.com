import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanFiles } from "./_scan";

const ROOT = join(__dirname, "../../../..");

/**
 * The trees that the codebase-scanning guards read, and the population each must still find.
 *
 * Fifteen tests in this suite police the codebase by walking it and asserting a CEILING — no
 * offenders, or no more than N. A ceiling is satisfied by finding nothing, so the day one of these
 * trees moves, empties, or changes file extension, those guards report zero violations and pass.
 * They would stay green forever while inspecting an empty set, and nothing would announce it.
 *
 * `readdirSync` throws on a missing directory, so a deleted or renamed tree already fails loudly.
 * This covers the quiet case: the directory still exists but no longer holds what the guards were
 * written to read.
 *
 * Counts measured 2026-08-11. The floors sit far below the real numbers so ordinary refactors,
 * deletions and reorganisation never cause noise — only a collapse does.
 */
const TREES: { label: string; dir: string; exts: string[]; floor: number; guards: string }[] = [
  {
    label: "app source (.tsx)",
    dir: join(ROOT, "apps/app/src"),
    exts: [".tsx"],
    floor: 100,   // measured: 196
    guards: "a11y-icon-buttons, date-picker-adoption, design-pass2, dialog-sweep, design-debt-ratchet, design-system-foundation, no-coming-soon, monorepo-audit",
  },
  {
    label: "app source (.ts/.tsx/.css)",
    dir: join(ROOT, "apps/app/src"),
    exts: [".ts", ".tsx", ".css"],
    floor: 150,
    guards: "menu-layer-stacking",
  },
  {
    label: "api source (.ts)",
    dir: join(ROOT, "packages/api/src"),
    exts: [".ts"],
    floor: 150,
    guards: "sovereignty, monorepo-audit",
  },
  {
    label: "api routes (.ts)",
    dir: join(ROOT, "packages/api/src/routes"),
    exts: [".ts"],
    floor: 30,    // measured: 63
    guards: "tenant-isolation-ratchet, auth-before-rbac",
  },
  {
    label: "web app router",
    dir: join(ROOT, "apps/web/app"),
    exts: [".tsx"],
    floor: 10,
    guards: "landing-metadata, no-coming-soon",
  },
];

describe("the codebase-scanning guards are reading a real codebase", () => {
  for (const tree of TREES) {
    it(`${tree.label} still holds the files its guards read`, () => {
      // scanFiles throws with an explanatory message when the population collapses; this asserts
      // the same property with the count visible in the failure output.
      const files = scanFiles(tree.dir, tree.exts, tree.floor);
      expect(files.length, `Guards depending on this tree (${tree.guards}) would pass by inspecting nothing.`)
        .toBeGreaterThanOrEqual(tree.floor);
    });
  }

  it("refuses a scan that comes back empty", () => {
    // Proves the helper is not itself decorative: a tree with no matching files must throw, not
    // return [] and let a ceiling assertion pass.
    expect(() => scanFiles(join(ROOT, "packages/api/src/routes"), [".no-such-extension"], 1))
      .toThrow(/found only 0 file\(s\)/);
  });
});
