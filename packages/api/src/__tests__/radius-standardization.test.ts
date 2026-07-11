import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * App-wide radius standardization. The remaining suggestion/action CHIPS on Home + Decisions are
 * squared (rounded-sm) to match the premium system. Intentionally circular/pill elements (dots,
 * metadata badges, avatars, icon FABs, attachment tokens) stay as-is, and no handler changes.
 */
const home = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/home.tsx", import.meta.url)), "utf8");
const decisions = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/decisions.tsx", import.meta.url)), "utf8");

describe("Home — suggestion/action chips squared", () => {
  it("no pill-shaped bordered chips remain (Task/Draft, More trigger, follow-ups)", () => {
    expect(home).not.toMatch(/rounded-full border px-3(\.5)? py-1\.5 text-\[12\.5px\]/);
  });
  it("the same chips are now squared", () => {
    expect(home).toMatch(/rounded-sm border px-3 py-1\.5 text-\[12\.5px\]/);
    expect(home).toMatch(/rounded-sm border px-3\.5 py-1\.5 text-\[12\.5px\]/);
  });
  it("chip handlers preserved (behavior unchanged)", () => {
    expect(home).toMatch(/onClick=\{\(\) => sendSuggestion\(/);
    expect(home).toMatch(/onClick=\{\(\) => setActionsOpen/);
  });
});

describe("Decisions — QUICK_ASKS chips squared", () => {
  it("no pill-shaped quick-ask chips remain", () => {
    expect(decisions).not.toMatch(/rounded-full border px-2 py-0\.5 text-\[10px\]/);
    expect(decisions).toMatch(/rounded-sm border px-2 py-0\.5 text-\[10px\]/);
  });
  it("quick-ask handler preserved", () => {
    expect(decisions).toMatch(/onClick=\{\(\) => ask\.mutate\(s\)\}/);
  });
});

describe("intentional circular/pill elements untouched", () => {
  it("Home keeps avatars/icon FABs/metadata pills/dots circular", () => {
    expect(home).toMatch(/h-8 w-8 items-center justify-center rounded-full/);  // composer icon FABs
    expect(home).toMatch(/rounded-full px-1\.5 py-px text-\[10px\] font-medium/); // priority badge
    expect(home).toMatch(/h-1\.5 w-1\.5 rounded-full/); // status dots
  });
  it("Decisions keeps risk/verdict status dots circular", () => {
    expect(decisions).toMatch(/h-2 w-2 shrink-0 rounded-full/);   // risk dot
    expect(decisions).toMatch(/h-1 w-1 rounded-full/);            // verdict/triage dots
  });
});
