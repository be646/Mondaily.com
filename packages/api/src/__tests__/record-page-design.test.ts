import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../../apps/app/src");
const app = (p: string) => readFileSync(join(APP, p), "utf8");

const detail = app("components/records/record-detail.tsx");
const table = app("components/records/record-table.tsx");
const tabs = app("components/ui/tabs.tsx");

/**
 * Pass R1 — record pages. Guards the design contract, not the pixels: each assertion below
 * corresponds to something the page actually got wrong, so a regression is legible.
 */
describe("Tabs is the one tab implementation", () => {
  it("renders a count whenever one is given — including zero", () => {
    // Hiding a zero makes the chrome REFLOW as data arrives and throws away the most useful thing
    // a tab says. The count-at-zero policy previously contradicted itself three ways across pages.
    expect(tabs).toMatch(/typeof t\.count === "number" && <CountBadge/);
    expect(tabs).not.toMatch(/count\s*>\s*0\s*&&/);
    // An unknown count must render NO badge — honestly different from a known zero.
    expect(tabs).toMatch(/Omit when the count is genuinely unknown/);
  });

  it("record detail uses it rather than a hand-rolled bar", () => {
    expect(detail).toMatch(/import \{ Tabs \} from "@\/components\/ui\/tabs"/);
    expect(detail).toMatch(/<Tabs\b/);
    // the old bespoke bar is gone
    expect(detail).not.toMatch(/tabs\.map\(t => \{[\s\S]{0,200}<button key=\{t\} onClick=\{\(\) => setTab\(t\)\}/);
  });

  it("counts come only from data already in cache — no new per-tab queries", () => {
    // Both count reads are `enabled: false`, so they observe what the Overview panels fetched and
    // never issue a request of their own. An eager count query per tab is a data change, not a
    // layout change, and must not ride along in a design pass.
    const notes = detail.slice(detail.indexOf('queryKey: ["notes", recordId], enabled: false'));
    expect(notes.length).toBeGreaterThan(0);
    expect(detail).toMatch(/queryKey: \["tasks", recordId\], enabled: false/);
    expect(detail).toMatch(/queryKey: \["records", objectType\], enabled: false/);
  });
});

describe("record detail structure", () => {
  it("has a 370px identity column with a label/value attribute grid", () => {
    expect(detail).toMatch(/w-\[370px\]/);
    // every attribute row type shares one grid: stage, status, custom, owner, plain field
    const rows = detail.match(/grid-cols-\[120px_1fr\]/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it("shows the record name as identity, not a field label", () => {
    // was text-[13px] font-bold uppercase — every record read like a header cell
    expect(detail).toMatch(/text-\[20px\] font-semibold[^"]*">\{name\}<\/h1>/);
    expect(detail).not.toMatch(/uppercase truncate">\{name\}<\/h1>/);
  });

  it("invites a value instead of showing a broken-looking dash", () => {
    expect(detail).toMatch(/Set a value…/);
    expect(detail).not.toMatch(/— set (stage|status|\{customType\})/);
    // Highlight cards state the absence in words so the grid never collapses
    expect(detail).toMatch(/Not set<\/span>/);
  });

  it("section headers are quiet — content outranks its label", () => {
    // 20 headers were 9-11px semibold uppercase letterspaced. The one survivor is a progress-bar
    // stage label inside DealProgressBar, which is a data label in a viz, not a section header.
    const shouty = detail.match(/text-\[(9|10|11)px\] font-semibold uppercase tracking-wid/g) ?? [];
    expect(shouty).toHaveLength(0);
  });

  it("related sections offer a route to their full list", () => {
    expect(detail).toMatch(/onViewAll/);
    expect(detail).toMatch(/View all<\/button>/);
  });

  it("has no tab whose body is a hardcoded empty state", () => {
    // Files/Emails rendered "No files attached to this record yet." unconditionally — a claim
    // about data, not an empty state. A tab may only exist if it has a data source.
    expect(detail).not.toMatch(/No files attached to this record yet/);
    expect(detail).not.toMatch(/No emails linked yet/);
  });

  it("the intelligence block says 'nothing yet' ONCE, not four times", () => {
    // AIAgentOwnerChip / AIInsightBadge / AIHealthScore / AISignalList each render their own
    // negative empty state, so a record with no agent activity stacked four separate ways of
    // saying nothing in the narrowest column on the page.
    expect(detail).toMatch(/const anything = hasOwner \|\| hasSummary \|\| hasHealth \|\| hasSignals/);
    expect(detail).toMatch(/No agent has looked at this record yet/);
    // each part renders only when it has something to say
    for (const g of ["hasOwner   &&", "hasSummary &&", "hasHealth  &&", "hasSignals &&"]) {
      expect(detail).toContain(g);
    }
  });

  it("the identity column has no filled cards left", () => {
    // Everything else moved to hairlines in R1; these two kept a background and stood out.
    const health = app("components/ai/ai-intelligence.tsx");
    expect(health).not.toMatch(/<div className="rounded-sm p-3" style=\{\{ background: "var\(--surface-hover\)" \}\}>/);
    const lead = app("components/records/lead-score-badge.tsx");
    expect(lead).toMatch(/rounded-sm border \$\{colors\.edge\}/);
  });

  it("record navigation degrades honestly when the list cache is cold", () => {
    // On a deep link `siblings` is empty and the strip does not render, rather than inventing
    // a position like "1 of 1".
    expect(detail).toMatch(/siblingIndex >= 0 && siblings\.length > 1/);
  });
});

describe("record table", () => {
  it("opens the record on click; renaming is deliberate", () => {
    // Clicking a name started a rename, so the primary action was hidden behind a hover-only
    // chevron while the destructive-ish one was the default.
    expect(table).toMatch(/openTo=\{`\/objects\/\$\{objectType\}\/\$\{record\.id\}`\}/);
    expect(table).toMatch(/onDoubleClick=\{e => \{ e\.preventDefault\(\); startEdit\(\); \}\}/);
    // the hover chevron stays for discoverability
    expect(table).toMatch(/<ChevronRight size=\{11\}\/>/);
  });

  it("does not style a text input as a solid button", () => {
    // The edit input carried `btn-solid`, so an editing cell rendered as a filled solid button.
    const input = table.slice(table.indexOf("if (editing) {"), table.indexOf("const shown = display(raw);"));
    expect(input).not.toMatch(/btn-solid/);
  });

  it("separates sticky columns with a hairline, not a drop shadow", () => {
    expect(table).not.toMatch(/shadow-\[2px_0_8px/);
  });
});

/**
 * Phase 2 — adoption sweep. The design system was already ~80% right; what was missing was
 * adoption. These guard the shared primitives against re-forking.
 */
describe("one page-header component", () => {
  it("FinanceHeader is an alias, not a second implementation", () => {
    // It was a byte-identical COPY of CommandPageHeader minus the divider, so the two could drift
    // independently — and the app had two page headers with no way to tell which was canonical.
    const finance = app("components/finance/finance-toolbar.tsx");
    expect(finance).toMatch(/<CommandPageHeader/);
    expect(finance).toMatch(/divider=\{false\}/);
    // no duplicated markup left
    expect(finance).not.toMatch(/soul-kicker/);
    expect(finance).not.toMatch(/text-\[16px\] font-semibold tracking-tight/);
  });
});

describe("separation is hairlines, not shadows", () => {
  const FORBIDDEN_SHADOWS = /shadow-2xl|shadow-lg|shadow-\[0_\d+px_\d+px_rgba\(0,0,0,0\.7\)\]/;

  it("no drop shadows on the surfaces this pass covered", () => {
    // 66 shadow utilities across 45 files. 28 of the 29 shadow-2xl sites already had a border and
    // the 29th used .surface-modal (which sets one), so every shadow was pure redundancy.
    for (const f of [
      "routes/dashboard/tasks.tsx",
      "routes/dashboard/notes.tsx",
      "components/records/record-table.tsx",
      "components/records/record-detail.tsx",
      "components/ui/command-palette.tsx",
    ]) {
      expect(app(f), `${f} should separate with a hairline`).not.toMatch(FORBIDDEN_SHADOWS);
    }
  });
});

describe("every section has its own identity", () => {
  it("calendar and messages are in both section maps", () => {
    // Both were missing, so they fell back to hue 0 and the callsign "MONDAILY" — the only two
    // sections in the app with no identity of their own.
    const sections = app("lib/sections.ts");
    for (const route of ["/calendar", "/messages"]) {
      expect(sections.match(new RegExp(`"${route}"`, "g")) ?? [], `${route} in hue + callsign`).toHaveLength(2);
    }
    expect(sections).toMatch(/"\/calendar", "SCHEDULE"/);
    expect(sections).toMatch(/"\/messages", "THREAD"/);
  });
});
