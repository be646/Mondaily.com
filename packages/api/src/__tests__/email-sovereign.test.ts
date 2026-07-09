import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeSubject, parseAddr, threadIdFor, mergeMessage, newMessageId, buildOutboundMessage, attachmentPath,
  inboundAddressFor, mailDomainConfigured, workspaceIdFromRecipients, type InboundMessage, type ThreadData, type StoredAttachment,
} from "../lib/email-sovereign";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const emails = read("../routes/emails.ts");
const mail = read("../lib/mail.ts");

const ORIG = process.env.SOVEREIGN_MAIL_DOMAIN;
beforeEach(() => { process.env.SOVEREIGN_MAIL_DOMAIN = "inbound.mondaily.com"; });
afterEach(() => { if (ORIG === undefined) delete process.env.SOVEREIGN_MAIL_DOMAIN; else process.env.SOVEREIGN_MAIL_DOMAIN = ORIG; });

const msg = (o: Partial<InboundMessage>): InboundMessage => ({ message_id: "<m1@x>", from: "Ann <ann@acme.com>", to: "ws-w1@inbound.mondaily.com", subject: "Hi", text: "hello", date: "2026-07-01T09:00:00Z", ...o });

describe("normalizeSubject", () => {
  it("strips repeated reply/forward prefixes and collapses whitespace", () => {
    expect(normalizeSubject("Re: Fwd:  Q3   plan")).toBe("Q3 plan");
    expect(normalizeSubject("RE: RE: Deal")).toBe("Deal");
    expect(normalizeSubject("no prefix")).toBe("no prefix");
  });
});

describe("parseAddr", () => {
  it("parses name<email> and bare address, lowercasing the email", () => {
    expect(parseAddr("Ann Smith <Ann@Acme.com>")).toEqual({ name: "Ann Smith", email: "ann@acme.com" });
    expect(parseAddr("bob@x.io")).toEqual({ email: "bob@x.io" });
  });
});

describe("threadIdFor", () => {
  it("prefers the References root, then In-Reply-To (angle brackets stripped)", () => {
    expect(threadIdFor(msg({ references: ["<root@x>", "<mid@x>"] }))).toBe("root@x");
    expect(threadIdFor(msg({ in_reply_to: "<parent@x>" }))).toBe("parent@x");
  });
  it("with no references, derives a STABLE id from normalized subject + participants (reply groups with original)", () => {
    const a = threadIdFor(msg({ subject: "Project Falcon", from: "ann@acme.com", to: "ws-w1@inbound.mondaily.com" }));
    const b = threadIdFor(msg({ subject: "Re: Project Falcon", from: "ann@acme.com", to: "ws-w1@inbound.mondaily.com" }));
    expect(a).toBe(b);
    expect(a).toMatch(/^mtd-[0-9a-f]{24}$/);
  });
  it("different people or subject → different thread", () => {
    const a = threadIdFor(msg({ subject: "A", from: "x@a.com" }));
    const b = threadIdFor(msg({ subject: "B", from: "x@a.com" }));
    expect(a).not.toBe(b);
  });
});

describe("mergeMessage", () => {
  it("creates a thread from the first inbound message (unread, inbox folder)", () => {
    const t = mergeMessage(null, msg({}), "t1", "inbound");
    expect(t.thread_id).toBe("t1");
    expect(t.subject).toBe("Hi");
    expect(t.unread).toBe(true);
    expect(t.folders).toEqual(["inbox"]);
    expect(t.messages).toHaveLength(1);
    expect(t.participants.map(p => p.email).sort()).toEqual(["ann@acme.com", "ws-w1@inbound.mondaily.com"]);
    expect(t.source).toBe("sovereign");
  });
  it("appends a reply in time order and merges participants", () => {
    const t1 = mergeMessage(null, msg({ message_id: "<m1@x>", date: "2026-07-01T09:00:00Z" }), "t1", "inbound");
    const t2 = mergeMessage(t1, msg({ message_id: "<m2@x>", from: "Cara <cara@acme.com>", date: "2026-07-02T09:00:00Z" }), "t1", "inbound");
    expect(t2.messages.map(m => m.message_id)).toEqual(["m1@x", "m2@x"]);
    expect(t2.participants.map(p => p.email)).toContain("cara@acme.com");
  });
  it("is idempotent by Message-ID (webhook redelivery never duplicates)", () => {
    const t1 = mergeMessage(null, msg({ message_id: "<dup@x>" }), "t1", "inbound");
    const t2 = mergeMessage(t1, msg({ message_id: "<dup@x>" }), "t1", "inbound");
    expect(t2.messages).toHaveLength(1);
  });
  it("an outbound (sent) message marks the sent folder and doesn't force unread", () => {
    const t = mergeMessage(null, msg({}), "t1", "outbound");
    expect(t.folders).toEqual(["sent"]);
    expect(t.unread).toBe(false);
  });
});

describe("address routing — sovereign, spoof-safe", () => {
  it("mints a deterministic per-workspace address only when the domain is configured", () => {
    expect(mailDomainConfigured()).toBe(true);
    expect(inboundAddressFor("w1")).toBe("ws-w1@inbound.mondaily.com");
    delete process.env.SOVEREIGN_MAIL_DOMAIN;
    expect(mailDomainConfigured()).toBe(false);
    expect(inboundAddressFor("w1")).toBeNull();
  });
  it("resolves the workspace from a recipient on OUR domain with the ws- local part", () => {
    expect(workspaceIdFromRecipients(["ws-abc123@inbound.mondaily.com"])).toBe("abc123");
    expect(workspaceIdFromRecipients(["Team <ws-abc123@inbound.mondaily.com>"])).toBe("abc123");
  });
  it("rejects other domains and non-ws addresses (a spoofed To can't target a workspace)", () => {
    expect(workspaceIdFromRecipients(["ws-abc123@evil.com"])).toBeNull();
    expect(workspaceIdFromRecipients(["hello@inbound.mondaily.com"])).toBeNull();
    expect(workspaceIdFromRecipients([])).toBeNull();
  });
});

describe("outbound message construction + folding", () => {
  it("newMessageId is a well-formed Message-ID on our domain", () => {
    expect(newMessageId()).toMatch(/^<[0-9a-f-]{36}@inbound\.mondaily\.com>$/);
  });
  it("buildOutboundMessage carries threading headers so a reply groups with what it answers", () => {
    const m = buildOutboundMessage({ from: "ws-w1@inbound.mondaily.com", to: "ann@acme.com", subject: "Re: Q3", html: "<p>ok</p>", inReplyTo: "<orig@x>", references: ["<orig@x>"] });
    expect(m.in_reply_to).toBe("<orig@x>");
    expect(threadIdFor(m)).toBe("orig@x");    // folds into the same thread as the original
  });
  it("an outbound message merges into the thread as a sent (read) message", () => {
    const inbound = mergeMessage(null, msg({ message_id: "<in@x>" }), "t1", "inbound");
    const out = buildOutboundMessage({ from: "ws-w1@inbound.mondaily.com", to: "ann@acme.com", subject: "Re: Hi", html: "reply", inReplyTo: "<in@x>" });
    const merged = mergeMessage(inbound, out, "t1", "outbound");
    expect(merged.messages).toHaveLength(2);
    expect(merged.folders).toContain("sent");
  });
});

describe("attachments — safe paths + metadata on the message", () => {
  it("builds a workspace-prefixed, sanitized storage path (no traversal)", () => {
    expect(attachmentPath("w1", "<m1@x>", 0, "report.pdf")).toBe("w1/m1_x/0-report.pdf");
    expect(attachmentPath("w1", "<m@x>", 1, "../../etc/passwd")).toBe("w1/m_x/1-.._.._etc_passwd");
  });
  it("stores ONLY attachment metadata (never bytes) on the merged message", () => {
    const stored: StoredAttachment[] = [{ filename: "report.pdf", content_type: "application/pdf", size: 2048, path: "w1/m1/0-report.pdf" }];
    const t = mergeMessage(null, msg({ message_id: "<m1@x>" }), "t1", "inbound", stored);
    expect(t.messages[0].attachments).toEqual(stored);
    expect(JSON.stringify(t)).not.toContain("content_base64");
  });
  it("a message with no attachments has none", () => {
    const t = mergeMessage(null, msg({}), "t1", "inbound");
    expect(t.messages[0].attachments).toBeUndefined();
  });
});

describe("route + tier wiring", () => {
  it("inbound webhook is public, HMAC-verified, fail-closed (401 without secret), and idempotent-safe", () => {
    // defined BEFORE requireAuth
    expect(emails.indexOf('router.post("/inbound"')).toBeLessThan(emails.indexOf('router.use("*", requireAuth)'));
    expect(emails).toMatch(/if \(!secret\) return c\.json\(\{ error: "Sovereign mail isn't configured\." \}, 401\)/);
    expect(emails).toMatch(/createHmac\("sha256", secret\)\.update\(raw\)\.digest\("hex"\)/);
    expect(emails).toMatch(/timingSafeEqual/);
    expect(emails).toMatch(/workspaceIdFromRecipients\(recipients\)/);
    expect(emails).toMatch(/eq\("data->>thread_id", threadId\)/);   // upsert by thread
  });
  it("inbound uploads attachments to a private bucket and the download route is workspace-scoped", () => {
    expect(emails).toMatch(/storeAttachments\(workspaceId, msg\)/);
    expect(emails).toMatch(/const ATTACH_BUCKET = "email-attachments"/);
    expect(emails).toMatch(/bytes\.length > MAX_ATTACH_BYTES/);   // size cap
    const dl = emails.slice(emails.indexOf('router.get("/attachment"'));
    expect(dl).toMatch(/if \(!path\.startsWith\(`\$\{c\.get\("workspaceId"\)\}\/`\)\) return c\.json\(\{ error: "Not allowed\." \}, 403\)/);
    expect(dl).toMatch(/createSignedUrl\(path, 120\)/);
  });
  it("inbound-address is authed and reports the address + enabled flag", () => {
    expect(emails.indexOf('router.get("/inbound-address"')).toBeGreaterThan(emails.indexOf('router.use("*", requireAuth)'));
    expect(emails).toMatch(/address: inboundAddressFor\(c\.get\("workspaceId"\)\)/);
  });
  it("reply works WITHOUT Gmail (sovereign path) and folds the sent copy into the thread", () => {
    const reply = emails.slice(emails.indexOf('router.post("/threads/:id/reply"'), emails.indexOf('// ── Compose'));
    expect(reply).toMatch(/SOVEREIGN reply/);
    expect(reply).toMatch(/sendWorkspaceEmail\(c\.get\("workspaceId"\)/);
    expect(reply).toMatch(/mergeMessage\(tdata, sent, tdata\.thread_id, "outbound"\)/);
  });
  it("compose folds the sent message into a thread when native mail is configured", () => {
    const compose = emails.slice(emails.indexOf("// ── Compose"));
    expect(compose).toMatch(/if \(mailDomainConfigured\(\)\)/);
    expect(compose).toMatch(/mergeMessage\(\(existing\?\.data \?\? null\).*"outbound"\)/);
  });
  it("outbound send tries the SOVEREIGN relay FIRST, before Gmail and Resend", () => {
    expect(mail).toMatch(/sendViaSovereignRelay/);
    const fn = mail.slice(mail.indexOf("export async function sendWorkspaceEmail"));
    expect(fn.indexOf("sendViaSovereignRelay")).toBeLessThan(fn.indexOf("sendViaGoogle"));
    expect(fn.indexOf("sendViaGoogle")).toBeLessThan(fn.indexOf("sendViaTransactional"));
    // relay is fail-closed on missing env
    expect(mail).toMatch(/if \(!url \|\| !secret\) return false/);
  });
});
