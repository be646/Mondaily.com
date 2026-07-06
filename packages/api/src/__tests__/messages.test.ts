import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../routes/messages.ts", import.meta.url)), "utf8");
const page = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/routes/dashboard/messages.tsx", import.meta.url)), "utf8");

describe("Inbox — workspace isolation", () => {
  it("every internal_messages query is scoped by workspace_id (filter or insert payload)", () => {
    // Each access to the table must have a workspace_id constraint within its statement window.
    let idx = src.indexOf('.from("internal_messages")');
    let count = 0;
    while (idx !== -1) {
      const window = src.slice(idx, idx + 400);
      expect(window, window.slice(0, 90)).toMatch(/\.eq\("workspace_id", ws\)|workspace_id: ws/);
      count++;
      idx = src.indexOf('.from("internal_messages")', idx + 1);
    }
    expect(count).toBeGreaterThan(2);
  });
  it("the member directory is workspace-scoped", () => {
    expect(src).toMatch(/from\("workspace_members"\)[\s\S]*?\.eq\("workspace_id", workspaceId\)/);
  });
});

describe("Inbox — participant access + privacy", () => {
  it("threads are keyed to the caller+other pair (can't read an arbitrary pair)", () => {
    expect(src).toMatch(/const threadKey = \(a: string, b: string\) => \[a, b\]\.sort\(\)\.join\(":"\)/);
    expect(src).toMatch(/const key = threadKey\(me, other\)/);
  });
  it("the inbox only returns conversations the caller is part of", () => {
    expect(src).toMatch(/\.or\(`sender_id\.eq\.\$\{me\},recipient_id\.eq\.\$\{me\}`\)/);
  });
  it("the other party must be a real member of THIS workspace (isolation guard)", () => {
    expect(src).toMatch(/if \(!dir\.has\(other\)\) return c\.json\(.*404\)/);
    expect(src).toMatch(/Recipient is not a member of this workspace/);
  });
  it("there is NO admin/role bypass that reads other members' DMs", () => {
    // Reads never branch on role — privacy is by participant, not by permission level.
    const readSection = src.slice(0, src.indexOf('router.post("/"'));
    expect(readSection).not.toMatch(/isWorkspaceAdmin|requireAdminRole|role === "admin"|role === "owner"/);
  });
});

describe("Inbox — unread state + mark read", () => {
  it("a sent message starts UNREAD (inserted without read_at)", () => {
    const send = src.slice(src.indexOf('router.post("/"'));
    expect(send).toMatch(/\.insert\(\{ workspace_id: ws, thread_key: threadKey\(me, recipient_id\), sender_id: me, recipient_id, body \}\)/);
    expect(send).not.toMatch(/read_at:/);   // no read_at on insert → unread
  });
  it("opening a thread marks the caller's incoming messages read", () => {
    expect(src).toMatch(/\.update\(\{ read_at: now \}\)[\s\S]*?\.eq\("recipient_id", me\)[\s\S]*?\.is\("read_at", null\)/);
  });
});

describe("Inbox — notification for the recipient (in-app; email only if configured)", () => {
  it("a new message inserts an in-app notification addressed to the RECIPIENT", () => {
    const send = src.slice(src.indexOf('router.post("/"'));
    expect(send).toMatch(/from\("notifications"\)\.insert\(\{[\s\S]*?user_id: recipient_id[\s\S]*?type: "message"/);
  });
  it("email is best-effort and only sent when a recipient email exists + provider is configured", () => {
    const send = src.slice(src.indexOf('router.post("/"'));
    expect(send).toMatch(/if \(recipient\.email\)/);                 // gated on having an address
    expect(src).toMatch(/import \{ sendTransactionalEmail \} from "\.\.\/lib\/mail"/); // existing safe mail helper
  });
});

describe("Inbox UI — functional page (picker, empty CTA, i18n)", () => {
  it("has a New-message member picker that excludes yourself and calls the thread route", () => {
    expect(page).toMatch(/function NewMessageModal/);
    expect(page).toMatch(/apiClient\.get\("\/workspace\/members-full"\)/);
    expect(page).toMatch(/m\.id !== me\.userId/);        // can't DM yourself
    expect(page).toMatch(/onPick\(m\.id\)/);
  });
  it("empty state offers 'Message a teammate' and opens the picker", () => {
    expect(page).toMatch(/t\("inbox\.message_teammate"\)/);
    expect(page).toMatch(/setPickerOpen\(true\)/);
  });
  it("sends via POST /messages and localizes core labels", () => {
    expect(page).toMatch(/apiClient\.post\("\/messages", \{ recipient_id: otherId, body \}\)/);
    expect(page).toMatch(/t\("inbox\.title"\)/);
    expect(page).toMatch(/t\("inbox\.send"\)/);
  });
  it("message body itself is never run through the translator (content stays verbatim)", () => {
    // rendered raw from m.body — no t()/applyTerms wrapping of message content
    expect(page).toMatch(/whitespace-pre-wrap break-words[^>]*>\{m\.body\}/);
  });
});
