import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Button-cluster consolidation. Secondary actions moved into a squared, keyboard-accessible
 * ActionMenu — but NO action may be removed and NO handler may change. These source guards prove
 * every relocated action still exists and each page's primary actions stay visible.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../../../apps/app/src/${p}`, import.meta.url)), "utf8");
const controls = read("components/ui/controls.tsx");
const discovery = read("routes/dashboard/discovery.tsx");
const decisions = read("routes/dashboard/decisions.tsx");

describe("ActionMenu primitive — squared, accessible, closes safely", () => {
  it("is exported and uses menu roles", () => {
    expect(controls).toMatch(/export function ActionMenu/);
    expect(controls).toMatch(/role="menu"/);
    expect(controls).toMatch(/role="menuitem"/);
  });
  it("is keyboard accessible (open/move/run/close)", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      expect(controls, key).toMatch(new RegExp(`"${key}"`));
    }
    expect(controls).toMatch(/aria-haspopup="menu"/);
    expect(controls).toMatch(/aria-expanded=\{open\}/);
  });
  it("closes on outside click and works on touch (click-driven)", () => {
    expect(controls).toMatch(/addEventListener\("mousedown", onDoc\)/);
  });
  it("keeps the app's control radius contract (6px, never bubbly)", () => {
    expect(controls).toMatch(/borderRadius: 4/);
    // Controls moved from rounded-sm to rounded-md (6px) in Pass NAV-S — the measured control
    // family the whole app now follows. The invariant this guard protects is unchanged: no pills,
    // no rounded-full chrome.
    const start = controls.indexOf("export function ActionMenu");
    const block = controls.slice(start, controls.indexOf("export function", start + 20));
    expect(block).toMatch(/rounded-(sm|md) border/);
    expect(block).not.toMatch(/rounded-full/);
  });
});

describe("Discovery LeadCard — 5 secondary actions preserved in the menu, primaries visible", () => {
  it("secondary actions all still invoked (same handlers) inside ActionMenu", () => {
    expect(discovery).toMatch(/<ActionMenu[^]*?onClick: \(\) => enrich\.mutate\(\)/);
    expect(discovery).toMatch(/onClick: \(\) => outreach\.mutate\(\)/);
    expect(discovery).toMatch(/onClick: \(\) => leadTask\.mutate\(\)/);
    expect(discovery).toMatch(/onClick: \(\) => leadDecision\.mutate\(\)/);
    expect(discovery).toMatch(/label: "Ask AI"[^]*?onClick: \(\) => requestAsk\(/);
  });
  it("primary Save + Add-to-list stay visible (not in the menu)", () => {
    expect(discovery).toMatch(/save\.mutate\(\)/);
    expect(discovery).toMatch(/Save as lead/);
    expect(discovery).toMatch(/addToList\.mutate/);
    expect(discovery).toMatch(/Add to list/);
  });
});

describe("Discovery — action buttons squared, metadata pills left as-is", () => {
  it("no bordered pill-shaped action buttons remain (all squared to rounded-sm)", () => {
    expect(discovery).not.toMatch(/rounded-full border/);
    expect(discovery).toMatch(/rounded-sm border px-2\.5/);
  });
  it("primary Save buttons are squared (white-fill = action, not a status pill)", () => {
    expect(discovery).toMatch(/gap-1\.5 rounded-sm px-2\.5 py-1 text-\[11px\] font-medium text-white/);
    expect(discovery).not.toMatch(/gap-1\.5 rounded-full px-2\.5 py-1 text-\[11px\] font-medium text-white/);
  });
  it("intentional metadata pills stay pill-shaped (Saved/In-graph status, priority/confidence, dots)", () => {
    expect(discovery).toMatch(/gap-1 rounded-full px-2\.5 py-1 text-\[11px\] font-medium" style=\{\{ color: st\.existed/); // Saved / In graph
    expect(discovery).toMatch(/rounded-full px-1\.5 py-0\.5 text-\[9\.5px\] font-semibold/); // priority / confidence badge
    expect(discovery).toMatch(/h-1\.5 w-1\.5 rounded-full/); // status dots
  });
});

describe("Decisions — AI tools consolidated, per-decision actions stay visible", () => {
  it("AI triage / clear ranking / adjudicate preserved (same handlers) in ActionMenu", () => {
    expect(decisions).toMatch(/<ActionMenu[^]*?onClick: runTriage/);
    expect(decisions).toMatch(/onClick: \(\) => setTriage\(null\)/);
    expect(decisions).toMatch(/onClick: adjudicateVisible/);
  });
  it("Approve / Reject / Snooze remain visible on each row (untouched)", () => {
    expect(decisions).toMatch(/onResolve\(d, "approve"\)/);
    expect(decisions).toMatch(/onResolve\(d, "reject"/);
    expect(decisions).toMatch(/onResolve\(d, "snooze"/);
  });
});
