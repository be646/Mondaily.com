import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Calendar smart-identity pass. Visual-only improvements (selected-event ring, Meeting Agent glyph,
 * empty-state icon) — every existing action, the real time grid, and honest AI proof must survive.
 */
const cal = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/calendar.tsx", import.meta.url)), "utf8");

describe("premium identity improvements present", () => {
  it("selected event gets a haloed ring + lift (clear active state)", () => {
    expect(cal).toMatch(/boxShadow: on \? `0 0 0 1\.5px var\(--surface-page\), 0 0 0 3px \$\{tone\.edge\}/);
    expect(cal).toMatch(/zIndex: on \? 20 : 10/);
  });
  it("Meeting Agent panel (CoPilot) carries the Wand2 identity glyph", () => {
    const coPilot = cal.slice(cal.indexOf("function CoPilot"));
    expect(coPilot).toMatch(/<Wand2 size=\{9\}/);
  });
  it("empty grid state shows a calm calendar icon (now inside the guided card's accent tile)", () => {
    const empty = cal.slice(cal.indexOf("function GridEmpty"), cal.indexOf("function TodayBriefingPanel"));
    expect(empty).toMatch(/<CalendarDays size=\{15\}/);
    // Still honest real actions — the guided card carries the same three handlers.
    for (const h of ["onCreate", "onDraft", "onFollowups"]) expect(empty).toContain(h);
  });
});

describe("every existing action preserved (nothing removed)", () => {
  it("New meeting + slot-click create + event open", () => {
    expect(cal).toMatch(/onClick=\{openCreate\}/);          // New meeting
    expect(cal).toMatch(/onSlot=\{openSlot\}/);             // slot-click create
    expect(cal).toMatch(/onClick=\{\(ev\) => \{ ev\.stopPropagation\(\); onOpen\(pl\.e\.id\); \}\}/); // open event block
  });
  it("Join call + prepare brief + draft agenda + follow-ups", () => {
    expect(cal).toMatch(/navigate\(`\/calls\/\$\{e\.id\}`\)/);   // Join call
    expect(cal).toMatch(/prepare\.mutate\(\)/);                  // prepare brief
    expect(cal).toMatch(/draftAgenda/);                         // AI agenda draft
    expect(cal).toMatch(/saveAgenda\.mutate\(\)/);              // save agenda
    expect(cal).toMatch(/addCall\.mutate\(\)/);                 // add call link
  });
  it("still a real time grid (not replaced by a card/list)", () => {
    expect(cal).toMatch(/<TimeGrid days=\{\[anchor\]\}/);       // day
    expect(cal).toMatch(/<TimeGrid days=\{anchorWeek\}/);       // week
  });
  it("Today's Brief remains interactive (clickable meetings + honest empty)", () => {
    expect(cal).toMatch(/onClick=\{\(\) => onOpen\(b\.next!\.id\)\}/);   // next meeting clickable
    expect(cal).toMatch(/onClick=\{\(\) => onOpen\(a\.id\)\}/);          // attention rows clickable
  });
});

describe("no fake AI / squared modal", () => {
  it("AI Meeting Brief stays source-backed (only renders with a real prep result)", () => {
    // `prep` = the real cached-or-fresh prepare result; the brief renders ONLY when it exists.
    expect(cal).toMatch(/prep \? \(\s*<PrepView r=\{prep\}/);
    // And prep is only ever the actual server result (cache seed or this run) — never fabricated.
    expect(cal).toMatch(/prepare\.data \?\? qc\.getQueryData<PrepResult>\(\["calendar-prep", id\]\)/);
  });
  it("New meeting modal is squared (no bubbly radius on container/fields)", () => {
    const modal = cal.slice(cal.indexOf("function CreateModal"));
    expect(modal).not.toMatch(/rounded-(full|lg|xl|2xl)/);
    expect(modal).toMatch(/w-full rounded-sm border bg-transparent/);   // squared field
  });
});
