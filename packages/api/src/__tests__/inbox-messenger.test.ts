import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Inbox premium messenger pass. Visual-only (squared bubbles/attachments/modal, clearer selected
 * thread, calmer unread badges, better empty state). Every chat action, the honest read state, and
 * mobile single-pane behavior must survive.
 */
const inbox = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/messages.tsx", import.meta.url)), "utf8");

describe("premium squared styling (no bubbly bubbles/cards/modal)", () => {
  it("message bubbles are squared (rounded-sm, not rounded-lg)", () => {
    expect(inbox).toMatch(/max-w-\[78%\] rounded-sm px-3\.5 py-2/);
    expect(inbox).not.toMatch(/max-w-\[78%\] rounded-lg/);
  });
  it("attachment cards are squared", () => {
    expect(inbox).toMatch(/gap-2 rounded-sm px-2\.5 py-2 text-left/);
  });
  it("modal controls squared (tabs/search/member rows — no rounded-lg/full there)", () => {
    expect(inbox).not.toMatch(/rounded-full px-3 py-1 text-\[11\.5px\]/);   // mode tab
    expect(inbox).not.toMatch(/rounded-lg border px-2\.5 py-1\.5/);          // search
    expect(inbox).not.toMatch(/rounded-lg px-2\.5 py-2 text-left/);          // member row
  });
  it("avatars stay circular (intentional messenger convention)", () => {
    expect(inbox).toMatch(/rounded-full object-cover/);
  });
});

describe("hierarchy improvements", () => {
  it("selected thread + group show a left accent bar", () => {
    expect((inbox.match(/boxShadow: (active === th\.other_id|activeGroup === g\.group_id) \? "inset 3px 0 0 var\(--section-accent\)"/g) ?? []).length).toBe(2);
  });
  it("unread badges are calmer (squared, soft accent — not solid white-on-accent)", () => {
    expect(inbox).toMatch(/rounded-sm px-1\.5 py-px text-\[10px\] font-semibold" style=\{\{ background: "var\(--section-accent-soft\)", color: "var\(--section-accent\)" \}\}/);
    expect(inbox).not.toMatch(/rounded-full px-1\.5 py-px text-\[10px\] font-semibold text-white/);
  });
  it("DM vs Groups separation kept + no-thread placeholder has an icon", () => {
    expect(inbox).toMatch(/Direct messages/);
    expect(inbox).toMatch(/<InboxIcon size=\{26\}[^]*?inbox\.select_conversation/);
  });
});

describe("every chat action still exists (nothing removed/hidden)", () => {
  it("send / attach / AI draft / delete / copy / group create / leave / search", () => {
    expect(inbox).toMatch(/send\.mutate/);           // send message
    expect(inbox).toMatch(/attach/);                 // attach file
    expect(inbox).toMatch(/aiDraft/);                // AI draft
    expect(inbox).toMatch(/del\.mutate\(m\.id\)/);   // delete own message
    expect(inbox).toMatch(/copyMsg\(m\)/);           // copy message
    expect(inbox).toMatch(/createGroup/);            // create group
    expect(inbox).toMatch(/leave\.mutate/);          // leave group
    expect(inbox).toMatch(/setSearch/);              // search messages
  });
  it("read state stays honest (from real read_at, never faked)", () => {
    expect(inbox).toMatch(/m\.read_at \? <><CheckCheck size=\{11\} \/> Read<\/> : <><Check size=\{11\} \/> Sent<\/>/);
  });
  it("mobile single-pane: list hides when a thread is open + back button", () => {
    expect(inbox).toMatch(/\(active \|\| activeGroup\) \? "hidden lg:flex" : "flex"/);
    expect((inbox.match(/onClick=\{onBack\} className="btn-icon h-7 w-7 lg:hidden"/g) ?? []).length).toBe(2);
  });
});
