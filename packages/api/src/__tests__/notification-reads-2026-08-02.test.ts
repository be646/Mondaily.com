import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lib = () => read("packages/api/src/lib/notification-reads.ts");
const router = () => read("packages/api/src/routes/notifications.ts");
const appData = () => read("packages/api/src/routes/app-data.ts");
const sql = () => read("packages/db/migrations/20260802_notification_reads.sql");

/**
 * Two kinds of notification live in one table and do not share a definition of "read". Personal
 * rows have one reader, so is_read on the row is correct. Broadcast rows (user_id IS NULL) are
 * addressed to everyone, and keeping their read state on the shared row means the first member to
 * open the bell marks it read for the whole team.
 *
 * MEASURED 2026-08-02: no code path currently writes a broadcast, so this is a latent bug on a
 * read path that already accepts them — not lost notifications in production today.
 */
describe("read state for a shared row is per-reader", () => {
  it("keeps personal rows on is_read, and does not migrate them", () => {
    // They have exactly one reader; rewriting that would mean migrating data to fix what was
    // never broken.
    expect(lib()).toMatch(/if \(r\.user_id != null\) return r;/);
    expect(sql()).toMatch(/Personal notifications \(user_id set\) keep using is_read/);
  });

  it("REPLACES a broadcast's stored is_read rather than OR-ing it", () => {
    // Honouring a legacy `true` there would reproduce the bug for every notification already
    // wrongly marked read by whoever opened the bell first.
    const src = lib();
    expect(src).toMatch(/return \{ \.\.\.r, is_read: at != null, read_at: at \?\? null \};/);
    expect(src).not.toMatch(/is_read: r\.is_read \|\|/);
  });

  it("a failed lookup falls to UNREAD, never to read", () => {
    // Worst case is a notification shown twice, not one never shown.
    expect(lib()).toMatch(/if \(error\) return rows\.map\(r => \(r\.user_id == null \? \{ \.\.\.r, is_read: false, read_at: null \} : r\)\)/);
  });
});

describe("marking read cannot touch somebody else's row", () => {
  it("writes a per-user record for a broadcast, and the row only for its owner", () => {
    const src = lib();
    expect(src).toMatch(/if \(row\.user_id == null\) \{[\s\S]{0,400}from\("notification_reads"\)[\s\S]{0,200}upsert/);
    expect(src).toMatch(/if \(row\.user_id !== userId\) return false;/);
  });

  it("is idempotent — opening the bell twice must not fail on the primary key", () => {
    expect(lib()).toMatch(/onConflict: "notification_id,user_id"/);
  });

  it("read-all marks broadcasts for THIS user only, never on the shared rows", () => {
    const src = lib();
    const all = src.slice(src.indexOf("export async function markAllRead"));
    expect(all).toMatch(/\.eq\("user_id", userId\)\s*\n\s*\.eq\("is_read", false\)/);
    expect(all).toMatch(/from\("notification_reads"\)\s*\n\s*\.upsert\(broadcasts\.map/);
    // It must not update is_read on the broadcast rows themselves.
    expect(all).not.toMatch(/\.is\("user_id", null\)[\s\S]{0,120}update\(/);
  });

  it("reports not-found instead of a silent ok", () => {
    // The previous version reported success even when its filters matched no row.
    expect(router()).toMatch(/if \(!ok\) return c\.json\(\{ error: "Not found" \}, 404\)/);
  });
});

describe("there is exactly ONE implementation", () => {
  it("app-data delegates instead of keeping its own copy", () => {
    // The same bug existed in the canonical router AND here; it was fixed in one and not the
    // other, which is the argument for the logic living in one place.
    const src = appData();
    expect(src).toMatch(/import \{ markRead, markAllRead \} from "\.\.\/lib\/notification-reads"/);
    expect(src).not.toMatch(/function ownNotifications/);
  });

  it("no route writes is_read on a notification directly any more", () => {
    for (const src of [router(), appData()]) {
      expect(src).not.toMatch(/\.update\(\{ is_read: true, read_at:/);
    }
  });

  it("the GET path scopes read state before anything downstream sees it", () => {
    expect(router()).toMatch(/const scoped = await withReadState\(data \?\? \[\], userId\)/);
  });
});

describe("the table is scoped and cleans up after itself", () => {
  it("cascades, so deleting a notification does not leave orphan read rows", () => {
    expect(sql()).toMatch(/references notifications\(id\) on delete cascade/);
  });

  it("is keyed per (notification, user) and indexed for the question actually asked", () => {
    expect(sql()).toMatch(/primary key \(notification_id, user_id\)/);
    expect(sql()).toMatch(/on notification_reads \(user_id, notification_id\)/);
  });

  it("is not reachable by the browser's roles", () => {
    expect(sql()).toMatch(/revoke all on notification_reads from public, anon, authenticated/);
  });
});
