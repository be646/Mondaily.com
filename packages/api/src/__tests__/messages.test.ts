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
      // `.insert(row)` builds its payload just above — that builder must carry workspace_id.
      if (/\.insert\(row\)/.test(window)) {
        expect(src).toMatch(/const row: Record<string, unknown> = \{ workspace_id: ws, thread_key: (threadKey\(me, rid\)|groupThreadKey\(group_id\)), sender_id: me/);
      } else {
        expect(window, window.slice(0, 90)).toMatch(/\.eq\("workspace_id", ws\)|workspace_id: ws/);
      }
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
    expect(send).toMatch(/const row: Record<string, unknown> = \{ workspace_id: ws, thread_key: threadKey\(me, rid\), sender_id: me, recipient_id: rid, body \}/);
    expect(send).not.toMatch(/read_at:/);   // no read_at on insert → unread
  });
  it("opening a thread marks the caller's incoming messages read", () => {
    expect(src).toMatch(/\.update\(\{ read_at: now \}\)[\s\S]*?\.eq\("recipient_id", me\)[\s\S]*?\.is\("read_at", null\)/);
  });
});

describe("Inbox — notification for the recipient (in-app; email only if configured)", () => {
  it("a new message inserts an in-app notification addressed to the RECIPIENT", () => {
    const send = src.slice(src.indexOf('router.post("/"'));
    expect(send).toMatch(/from\("notifications"\)\.insert\(\{[\s\S]*?user_id: rid[\s\S]*?type: "message"/);
  });
  it("email is best-effort and only sent when a recipient email exists + provider is configured", () => {
    const send = src.slice(src.indexOf('router.post("/"'));
    expect(send).toMatch(/if \(recipient\.email\)/);                 // gated on having an address
    expect(src).toMatch(/import \{ sendTransactionalEmail \} from "\.\.\/lib\/mail"/); // existing safe mail helper
  });
});

describe("PHASE 2 — AI draft assist (drafts only, never sends)", () => {
  it("POST /messages/draft returns text and does NOT insert/send a message", () => {
    const fn = src.slice(src.indexOf('router.post("/draft"'), src.indexOf('router.delete("/:id"'));
    expect(fn).toMatch(/return c\.json\(\{ draft \}\)/);
    expect(fn).not.toMatch(/\.from\("internal_messages"\)\.insert/);   // never writes a message
    expect(fn).not.toMatch(/from\("notifications"\)/);                  // never notifies
  });
  it("the draft is language-aware but never translates existing message content", () => {
    const fn = src.slice(src.indexOf('router.post("/draft"'), src.indexOf('router.delete("/:id"'));
    expect(fn).toMatch(/languageInstruction\(lang\)/);
    expect(fn).toMatch(/user_preferences.*language|resolveProfile\(settings\)\.language/);
  });
  it("draft fails closed without the sovereign gateway (no default provider)", () => {
    const fn = src.slice(src.indexOf('router.post("/draft"'), src.indexOf('router.delete("/:id"'));
    expect(fn).toMatch(/if \(!env\.baseURL \|\| !env\.apiKey\) return c\.json\(.*503\)/);
  });
  it("the compose UI drafts into the box and never auto-sends", () => {
    const fn = page.slice(page.indexOf("async function aiDraft"), page.indexOf("async function aiDraft") + 600);
    expect(fn).toMatch(/apiClient\.post<\{ draft\?: string; error\?: string \}>\("\/messages\/draft"/);
    expect(fn).toMatch(/setDraft\(r\.draft\)/);       // fills the box for review
    expect(fn).not.toMatch(/send\.mutate|apiClient\.post\("\/messages"/);  // no auto-send
  });
});

describe("PHASE 2 — delete own message (sender-only)", () => {
  it("DELETE /messages/:id is scoped to workspace AND the sender", () => {
    const fn = src.slice(src.indexOf('router.delete("/:id"'));
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)/);
    expect(fn).toMatch(/\.eq\("id", c\.req\.param\("id"\)\)/);
    expect(fn).toMatch(/\.eq\("sender_id", me\)/);    // ONLY the sender can delete
    expect(fn).toMatch(/if \(!count\) return c\.json\(.*404\)/);   // can't delete others' → not found
  });
});

describe("PHASE 2 — notification deep-link + read state", () => {
  it("message notification carries a metadata.route that opens the exact thread", () => {
    const send = src.slice(src.indexOf('router.post("/"'), src.indexOf('router.post("/draft"'));
    expect(send).toMatch(/metadata: \{ route: `\/messages\?to=\$\{me\}`/);
  });
  it("resolveNotificationLink handles the 'message' type", () => {
    const link = readFileSync(fileURLToPath(new URL("../../../../apps/app/src/lib/notification-link.ts", import.meta.url)), "utf8");
    expect(link).toMatch(/case "message": return "\/messages"/);
    expect(link).toMatch(/const route = str\(m\.route\)/);   // honors metadata.route first
  });
  it("read/sent state comes from real read_at, not a faked receipt", () => {
    expect(page).toMatch(/m\.mine && \(m\.read_at \? <><CheckCheck/);
    expect(page).toMatch(/read_at: string \| null/);   // surfaced from the API row
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
    expect(page).toMatch(/apiClient\.post\("\/messages", \{ recipient_id: otherId, body, \.\.\.\(pending\.length \? \{ attachments: pending \} : \{\}\) \}\)/);
    expect(page).toMatch(/t\("inbox\.title"\)/);
    expect(page).toMatch(/t\("inbox\.send"\)/);
  });
  it("message body itself is never run through the translator (content stays verbatim)", () => {
    // rendered raw from m.body — no t()/applyTerms wrapping of message content
    expect(page).toMatch(/whitespace-pre-wrap break-words[^>]*>\{m\.body\}/);
  });
});

describe("Inbox — message search", () => {
  it("search is workspace + participant scoped (only the caller's own conversations)", () => {
    const fn = src.slice(src.indexOf('router.get("/search"'), src.indexOf('router.get("/thread/:otherId"'));
    expect(fn).toMatch(/\.eq\("workspace_id", ws\)/);
    expect(fn).toMatch(/\.or\(`sender_id\.eq\.\$\{me\},recipient_id\.eq\.\$\{me\}`\)/);
  });
  it("ilike wildcards in the user query are escaped (no pattern widening)", () => {
    const fn = src.slice(src.indexOf('router.get("/search"'), src.indexOf('router.get("/thread/:otherId"'));
    expect(fn).toMatch(/replace\(\/\[%_\]\/g/);
  });
  it("the frontend exposes the search box and jumps into the matched thread", () => {
    expect(page).toMatch(/\/messages\/search\?q=/);
    expect(page).toMatch(/setActive\(hit\.other_id\)/);
  });
});

describe("Inbox — attachments", () => {
  it("uploads are keyed under the caller's own workspace/user prefix", () => {
    expect(src).toMatch(/const path = `\$\{ws\}\/\$\{me\}\/\$\{Date\.now\(\)\}/);
  });
  it("send rejects attachment paths outside the caller's own upload prefix", () => {
    expect(src).toMatch(/a\.path\.startsWith\(`\$\{ws\}\/\$\{me\}\/`\)/);
    expect(src).toMatch(/Invalid attachment reference/);
  });
  it("downloads require workspace prefix AND a message the caller participates in (DM party OR group member)", () => {
    const fn = src.slice(src.indexOf('router.get("/attachment"'), src.indexOf('/** POST /messages —'));
    expect(fn).toMatch(/path\.startsWith\(`\$\{ws\}\/`\)/);
    // Authorization now covers BOTH DM participants AND group members (the group-attachment
    // download fix). The old sender/recipient-only `.or()` under-authorized group recipients.
    expect(fn).toMatch(/isDmParticipant = msg\.sender_id === me \|\| msg\.recipient_id === me/);
    expect(fn).toMatch(/isGroupMember = msg\.group_id \? .*assertGroupMember\(ws, msg\.group_id/);
    expect(fn).toMatch(/if \(!isDmParticipant && !isGroupMember\) return/);
    expect(fn).toMatch(/createSignedUrl\(path, 120\)/);
  });
  it("the bucket is private and size/count caps exist", () => {
    expect(src).toMatch(/MSG_ATTACH_MAX_BYTES = 10 \* 1024 \* 1024/);
    expect(src).toMatch(/MSG_ATTACH_MAX_FILES = 5/);
  });
});

describe("Inbox — group chats", () => {
  it("every group read/send goes through assertGroupMember (membership, not role)", () => {
    expect(src).toMatch(/async function assertGroupMember\(ws: string, groupId: string, me: string\)/);
    const fn = src.slice(src.indexOf("async function assertGroupMember"));
    expect(fn.slice(0, 600)).toMatch(/\.eq\("workspace_id", ws\)\.eq\("group_id", groupId\)\.eq\("user_id", me\)/);
    for (const route of ['router.get("/group/:id"', 'router.post("/group/:id/members"']) {
      const seg = src.slice(src.indexOf(route), src.indexOf(route) + 700);
      expect(seg, route).toMatch(/assertGroupMember\(ws, groupId, me\)/);
    }
  });
  it("group sends are membership-guarded and exactly one of recipient_id/group_id is required", () => {
    expect(src).toMatch(/Boolean\(v\.recipient_id\) !== Boolean\(v\.group_id\)/);
    const seg = src.slice(src.indexOf("// ── Group branch"));
    expect(seg.slice(0, 400)).toMatch(/assertGroupMember\(ws, group_id, me\)/);
  });
  it("group creation validates every member against THIS workspace's directory", () => {
    const seg = src.slice(src.indexOf('router.post("/groups"'), src.indexOf('router.get("/group/:id"'));
    expect(seg).toMatch(/member_ids\.filter\(\(id\) => !dir\.has\(id\)\)/);
    expect(seg).toMatch(/not members of this workspace/);
  });
  it("inbox group unread is computed from the caller's own last_read_at, never faked", () => {
    expect(src).toMatch(/m\.sender_id !== me && \(!myRead \|\| m\.created_at > myRead\)/);
  });
});
