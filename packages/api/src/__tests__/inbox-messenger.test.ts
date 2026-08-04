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
    // Placeholder is now the shared EmptyState primitive, still icon + select-conversation copy.
    expect(inbox).toMatch(/<EmptyState icon=\{InboxIcon\}[^]*?inbox\.select_conversation/);
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

// ── Premium AI-native redesign pass (structured empty states, accessible modal, stronger honest AI) ──
describe("premium redesign — structured empty states (not giant dead panels)", () => {
  it("empty Inbox list is guided + branded, with an honest workspace-only / no-fake-presence line", () => {
    expect(inbox).toMatch(/Smart, private team messaging/);
    expect(inbox).toMatch(/Workspace-only\. No outside inboxes, no fake presence\./);
    // Real starting points, not decorative — both CTAs open the real picker.
    expect(inbox).toMatch(/t\("inbox\.message_teammate"\)/);
    expect(inbox).toContain("Create a group");
  });
  it("empty conversation panel is filled with intent: centered EmptyState + an honest capability rail", () => {
    // Still the shared EmptyState with the select-conversation copy…
    expect(inbox).toMatch(/<EmptyState icon=\{InboxIcon\}[^]*?inbox\.select_conversation/);
    // …plus a real capability rail describing what the messenger does (no metrics, no fake state).
    expect(inbox).toContain("Direct & groups");
    expect(inbox).toMatch(/AI draft[^]*?You review, you send/);
    // Not a bare centered void: the panel is a flex column that hosts the rail.
    expect(inbox).toMatch(/hidden flex-col overflow-hidden rounded-sm border lg:flex/);
  });
});

describe("premium redesign — accessible, keyboard-friendly new-message modal", () => {
  const modal = inbox.slice(inbox.indexOf("function NewMessageModal"));
  it("modal is a labelled dialog with a tablist and Esc-to-close", () => {
    // The dialog semantics moved to the shared <Modal> on 2026-08-04 — role="dialog",
    // aria-modal, aria-label={title} and Escape now come from one implementation instead of this
    // component's own copy. Verified on BOTH sides so neither half can quietly drop them.
    expect(modal).toMatch(/<Modal title=\{t\("inbox\.new_message"\)\}/);
    const shell = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/components/ui/modal.tsx", import.meta.url)), "utf8");
    expect(shell).toMatch(/role="dialog" aria-modal="true" aria-label=\{title\}/);
    expect(shell).toMatch(/e\.key === "Escape"/);
    expect(modal).toMatch(/role="tablist"/);
    expect(modal).toMatch(/role="tab" aria-selected=\{mode === m\}/);
    // (Escape is asserted on the shell above.)
  });
  it("modal controls expose focus-visible rings + labels (keyboard + a11y)", () => {
    expect(modal).toMatch(/aria-label="Group name"/);
    expect((modal.match(/focus-visible:ring-2/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Tabs stay squared (segmented grid), never pill-shaped.
    expect(modal).not.toMatch(/rounded-full/);
    expect(modal).toMatch(/grid grid-cols-2 gap-1 border-b p-2/);
  });
});

describe("premium redesign — AI draft reads as a reviewed assist, never fake automation", () => {
  it("draft panel states its honest scope: prompt-only, doesn't read the conversation, sent manually", () => {
    expect(inbox).toMatch(/it doesn't read the conversation/);
    expect(inbox).toMatch(/You send manually\./);
  });
  it("the unsent-draft marker spells out that nothing sends automatically", () => {
    expect(inbox).toContain("AI draft · review before sending");
    expect(inbox).toMatch(/nothing sends until you press Send/);
  });
  it("no fake presence / typing / auto-read anywhere in Inbox", () => {
    expect(inbox).not.toMatch(/online now|active now|is typing|typing…|last seen|seen just now/i);
  });
});
