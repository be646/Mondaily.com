import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Inbox/Calls audit. On a messaging surface the isolation pass matters most: a leak exposes private
 * conversations, and the usual hole is a write path that identifies a row by id alone.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const chats = () => read("packages/api/src/routes/chats.ts");
const messages = () => read("packages/api/src/routes/messages.ts");

describe("chat threads cannot change hands", () => {
  it("the upsert checks ownership first — conflict on `id` bypasses .eq() filters", () => {
    // Without this a request carrying another user's thread id overwrites that row and rewrites
    // user_id/workspace_id to the caller's, so the thread silently changes owner.
    const s = chats();
    expect(s).toMatch(/\.from\("chat_threads"\)\.select\("user_id, workspace_id"\)\.eq\("id", id\)\.maybeSingle\(\)/);
    expect(s).toMatch(/if \(existing && \(existing\.user_id !== me \|\| existing\.workspace_id !== ws\)\)/);
  });

  it("a foreign thread is reported as not found, not as forbidden", () => {
    // 403 would confirm the id exists.
    expect(chats()).toMatch(/return c\.json\(\{ error: "Not found" \}, 404\)/);
  });

  it("every other handler stays partitioned by user AND workspace", () => {
    const s = chats();
    for (const verb of ["delete"]) {
      expect(s).toMatch(new RegExp(`\\.${verb}\\(\\)[\\s\\S]{0,200}\\.eq\\("user_id"`));
    }
    expect(s).toMatch(/\.eq\("workspace_id", c\.get\("workspaceId"\)\)/);
  });
});

describe("messages stay participant-scoped", () => {
  it("an attachment is only downloadable by a DM participant or a group member", () => {
    const s = messages();
    expect(s).toMatch(/if \(!path\.startsWith\(`\$\{ws\}\/`\)\) return c\.json\(\{ error: "Not allowed\." \}, 403\)/);
    expect(s).toMatch(/if \(!isDmParticipant && !isGroupMember\)/);
  });

  it("only the sender can delete their own message", () => {
    expect(messages()).toMatch(/\.eq\("sender_id", me\);/);
  });

  it("group reads and membership writes both assert membership", () => {
    const s = messages();
    const groupRead = s.slice(s.indexOf('router.get("/group/:id"'), s.indexOf('router.post("/group/:id/members"'));
    expect(groupRead).toMatch(/assertGroupMember\(ws, groupId, me\)/);
    const addMembers = s.slice(s.indexOf('router.post("/group/:id/members"'));
    expect(addMembers.slice(0, 600)).toMatch(/if \(!\(await assertGroupMember\(ws, groupId, me\)\)\)/);
  });

  it("members can only be added from the workspace directory", () => {
    expect(messages()).toMatch(/\.filter\(\(id\) => dir\.has\(id\)\)/);
  });
});

describe("guest call access stays narrow", () => {
  it("guest tokens are signed, expiring and room-scoped, granting join only", () => {
    const g = read("packages/api/src/routes/guest-calls.ts");
    expect(g).toMatch(/enforces signature AND exp/);
    expect(g).toMatch(/roomJoin ONLY — never roomAdmin/);
  });

  it("the public endpoints are rate limited", () => {
    const g = read("packages/api/src/routes/guest-calls.ts");
    expect(g).toMatch(/rateLimit\(\{ max: 20, windowMs: 60_000 \}\)/);
    expect(g).toMatch(/rateLimit\(\{ max: 15, windowMs: 60_000 \}\)/);
  });
});
