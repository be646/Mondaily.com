import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const panel = () => read("apps/app/src/routes/dashboard/settings/data-health.tsx");
const clean = () => read("packages/api/src/routes/clean.ts");

/**
 * The cleaning endpoints could always find and collapse duplicates. What did not exist was a way to
 * LOOK at what they would do first, which is the only thing that makes a destructive bulk action
 * defensible. These tests are about supervision, not about the UI.
 */
describe("nothing is deleted that was not previewed first", () => {
  it("the panel asks for a dry run before it can offer to apply", () => {
    const src = panel();
    expect(src).toMatch(/"\/clean\/dedupe-records", \{ object_type: objectType, dry_run: true \}/);
    expect(src).toMatch(/"\/clean\/dedupe-records", \{ object_type: objectType, dry_run: false \}/);
    // The apply button only exists inside the plan block.
    const planBlock = src.slice(src.indexOf("{plan && ("));
    expect(planBlock).toMatch(/confirmAndApply/);
  });

  it("the confirm names the real counts from the plan, not a generic warning", () => {
    // "Are you sure?" is not a safety feature. "This deletes 14 records and cannot be undone" is.
    const src = panel();
    expect(src).toMatch(/Delete \$\{plan\.summary\.records_to_delete\} duplicate \$\{objectType\}\?/);
    expect(src).toMatch(/leaving \$\{plan\.summary\.would_remain\} of \$\{plan\.summary\.total_records\}/);
    expect(src).toMatch(/destructive: true/);
  });

  it("applying requires the dialog to resolve TRUE — dismissing does nothing", () => {
    expect(panel()).toMatch(/if \(ok\) applyMut\.mutate\(\)/);
  });
});

describe("weak matches are shown and never acted on", () => {
  it("offers no bulk action for name/phone groups", () => {
    // Two real businesses share a name every day. The server says as much in its guidance; the UI
    // must not quietly provide the button the server warns against.
    const src = panel();
    const weakBlock = src.slice(src.indexOf("Possible duplicates"), src.indexOf("{scan.strong_groups.length === 0"));
    expect(weakBlock).not.toMatch(/onClick=\{[^}]*Mut\.mutate/);
    expect(weakBlock).toMatch(/decide one at a time/);
  });

  it("keeps the server's own distinction between strong and weak keys", () => {
    expect(clean()).toMatch(/g\.match_key === "source_url" \|\| g\.match_key === "email"/);
    expect(panel()).toMatch(/Matched on a source URL or an email address/);
  });
});

describe("the panel reports what it could NOT do", () => {
  it("surfaces blocked groups with the server's reason rather than dropping them", () => {
    const src = panel();
    expect(src).toMatch(/plan\.summary\.groups_blocked_by_attachments/);
    expect(src).toMatch(/\{b\.why\}/);
  });

  it("discloses a truncated scan instead of implying it saw everything", () => {
    expect(panel()).toMatch(/scan\.summary\.truncated/);
    expect(panel()).toMatch(/partial picture/);
  });

  it("says which copy survives, so the choice is inspectable", () => {
    expect(panel()).toMatch(/Which copy survives: \{plan\.survivor_rule\}/);
    expect(clean()).toMatch(/survivor_rule: "richest payload wins/);
  });

  it("states plainly when nothing can be removed automatically", () => {
    expect(panel()).toMatch(/every duplicate copy carries notes, tasks or links/);
  });
});

describe("the panel is reachable", () => {
  it("is routed and present in the settings navigation", () => {
    expect(read("apps/app/src/App.tsx")).toMatch(/<Route path="data-health" element=\{<DataHealthSettings \/>\} \/>/);
    expect(read("apps/app/src/routes/dashboard/settings/layout.tsx")).toMatch(/\["data-health", Copy, "Data health"\]/);
  });

  it("is lazy-loaded, like every other settings page", () => {
    expect(read("apps/app/src/App.tsx")).toMatch(/const DataHealthSettings = lazy\(/);
  });
});

describe("the scan and the plan disagree on purpose, and the panel says so", () => {
  it("explains the gap instead of letting '1 found, 0 removable' read as a bug", () => {
    // Measured live on discovered-leads: the scan reports 1 strong group, the plan 0. The scan
    // flags a shared source_url so a human can look; the plan requires source_url AND a matching
    // name before deleting, because one website hosts two real businesses often enough to matter.
    const src = panel();
    expect(src).toMatch(/plan\.summary\.groups_to_collapse < scan\.summary\.strong_group_count/);
    expect(src).toMatch(/enough to look, but not\s*\n?\s*enough to delete/);
  });

  it("the stricter rule is the server's, not something the panel invented", () => {
    expect(clean()).toMatch(/Never source_url alone — one website can host two real entities/);
  });
});
