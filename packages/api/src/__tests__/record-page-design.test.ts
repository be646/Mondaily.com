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
    // Positive form on purpose. A negative like /count\s*>\s*0\s*&&/ encodes ONE spelling of the
    // bug and `count !== undefined && count > 0` walks straight past it — the same flaw that let
    // the column-header guard pass over shouting headers.
    const badge = tabs.slice(tabs.indexOf("function CountBadge"), tabs.indexOf("export function Tabs"));
    expect(badge).not.toMatch(/return null/);
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
    // Order-independent: assert no uppercase utility on the h1 at all, however the classes are
    // ordered, rather than matching one arrangement.
    const h1 = detail.match(/<h1 className="([^"]*)">\{name\}<\/h1>/)?.[1] ?? "";
    expect(h1).not.toMatch(/\buppercase\b/);
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

  it("column headers are sentence case, not shouted", () => {
    // NAME / EMAIL / JOB TITLE -> Name / Email / Job title. first-letter:uppercase on the lowercase
    // key gives SENTENCE case; `capitalize` would give title case ("Job Title"), which reads busier
    // at this row density and is not what the reference does.
    expect(table).toMatch(/first-letter:uppercase">\{col\.replaceAll\("_", " "\)\}/);
    // ORDER-INDEPENDENT. The first version of this guard only matched "uppercase tracking-*" and
    // PASSED while three column headers carried "tracking-widest uppercase" — the reversed token
    // order — so the headers were still shouting with a green test. Match the utilities
    // independently within one className instead of assuming Tailwind's ordering.
    for (const m of table.matchAll(/className=\{?"([^"]*)"/g)) {
      const cls = m[1] ?? "";
      if (/\buppercase\b/.test(cls) && /\btracking-(wide|wider|widest)\b/.test(cls)) {
        throw new Error(`shouty label left in record-table: "${cls}"`);
      }
    }
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

describe("call detail — chrome only, transcript untouched", () => {
  const cd = app("routes/dashboard/call-detail.tsx");

  it("uses the standard header with ONE saturated action", () => {
    // Was a bespoke header with Print / Reprocess / Run analysis all weighted identically, so
    // nothing read as the main action.
    expect(cd).toMatch(/<CommandPageHeader/);
    expect(cd).toMatch(/callsign="COMMS"/);
    const solid = cd.match(/btn-solid/g) ?? [];
    expect(solid).toHaveLength(1);
  });

  it("states WHY a section is empty rather than that it is empty", () => {
    // five bare strings ("No key topics extracted.") -> one shared component that says the
    // analysis has not run, which is the actual situation.
    expect(cd).toMatch(/function NotYet/);
    expect(cd).not.toMatch(/No key topics extracted\./);
    expect(cd).not.toMatch(/No action items identified\./);
    expect(cd).not.toMatch(/No next steps recommended\./);
  });

  it("keeps the transcript / audio pipeline intact", () => {
    // FORBIDDEN zone: this pass may restyle it and nothing more.
    for (const anchor of ["audioSrc", "transcriptSource(call)", "waveRef.current?.setTime", "reprocess.mutate()", "visibleTranscript"]) {
      expect(cd, `${anchor} must survive a visual pass`).toContain(anchor);
    }
  });
});

describe("home composer", () => {
  const home = app("routes/dashboard/home.tsx");

  it("is a column: question on top, controls in a bar inside it", () => {
    // Was one horizontal row, so the input competed for width with five buttons and a one-line box
    // invited a search query rather than a question.
    expect(home).toMatch(/ask-input chat-input-bar chat-input-orbit flex flex-col/);
    expect(home).toMatch(/control bar, inside the composer/);
    expect(home).toMatch(/minHeight: 52/);
  });

  it("keeps every control — nothing was removed, only regrouped", () => {
    for (const anchor of [
      "setPromptPickerOpen(o => !o)",   // +  quick prompts
      "setAttachOpen(o => !o)",         // 📎 attach record/file
      "voice.toggle",                   // mic dictation
      "onClick={newChat}",              // Clear
      "onClick={loading ? stop : send}",// send / stop
      "@-mention → record picker",      // @ picker behaviour
    ]) {
      expect(home, `${anchor} must survive the composer restyle`).toContain(anchor);
    }
  });

  it("no resting shadow on the composer", () => {
    // the chatting state carried a hand-rolled two-layer drop shadow
    expect(home).not.toMatch(/boxShadow: "0 -2px 24px -6px/);
  });
});
