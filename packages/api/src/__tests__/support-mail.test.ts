import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  supportReplyAddress, ticketIdFromRecipient, stripQuotedReply, sentAt,
  WAITING_REMINDER_DAYS, WAITING_CLOSE_DAYS,
} from "../lib/support-mail";
import { renderEmail, esc, quoteBlock } from "../lib/email-template";

// Reply routing only exists where sovereign receiving is configured — that is the whole point of
// the null return — so the routing tests must configure it rather than assert against a
// deployment that has it off.
process.env.SOVEREIGN_MAIL_DOMAIN = "inbound.mondaily.com";

/**
 * The parts of the support mail operation that fail SILENTLY.
 *
 * Every defect this guards against looks like success from outside: an email that sends but whose
 * reply cannot be routed, a reply that files but stores three copies of the thread, a deadline that
 * arrives before its own warning. None of them throw, and none show up in a 200.
 */

describe("reply routing", () => {
  const id = "6f1c2b8a-1111-4222-8333-444455556666";

  it("round-trips a ticket id through the reply address", () => {
    expect(ticketIdFromRecipient(supportReplyAddress(id)!)).toBe(id);
  });

  it("uses the domain the sovereign receiver actually accepts", () => {
    // A support@ address on some other domain has no MX and no receiver: every reply would bounce
    // while the code looked finished.
    expect(supportReplyAddress(id)).toContain("@inbound.mondaily.com");
  });

  it("offers no reply route at all when receiving is unconfigured", () => {
    const prev = process.env.SOVEREIGN_MAIL_DOMAIN;
    delete process.env.SOVEREIGN_MAIL_DOMAIN;
    try {
      expect(supportReplyAddress(id)).toBeNull();
      // …and the footer must then stop promising one.
      expect(renderEmail({ title: "t", preheader: "p", bodyHtml: "" })).not.toContain("reply to this email");
    } finally { process.env.SOVEREIGN_MAIL_DOMAIN = prev; }
  });

  it("survives the way mail servers hand us an address", () => {
    // Envelope recipients arrive with display names, angle brackets and inconsistent case.
    const found = ticketIdFromRecipient(`Mondaily Support <SUPPORT+T.${id.toUpperCase()}@mondaily.com>`);
    expect(found?.toLowerCase()).toBe(id);
  });

  it("claims nothing that is not a ticket reply", () => {
    // These must fall through to the normal inbox. A false positive here silently swallows a
    // customer's mail into a ticket thread they never opened.
    for (const a of ["support@mondaily.com", "ws-abc@inbound.mondaily.com", "bassem@example.com", ""]) {
      expect(ticketIdFromRecipient(a)).toBeNull();
    }
  });
});

describe("stripQuotedReply", () => {
  it("keeps the reply and drops the quoted thread", () => {
    const out = stripQuotedReply(
      "Yes, that fixed it — thanks!\n\nOn Tue, 5 Aug 2026 at 10:12, Mondaily support wrote:\n> Could you try again?",
    );
    expect(out).toBe("Yes, that fixed it — thanks!");
  });

  it("drops our own footer when a client quotes it back", () => {
    expect(stripQuotedReply("Still broken.\n\nSent by Mondaily. You can reply to this email directly"))
      .toBe("Still broken.");
  });

  it("NEVER returns empty — an unparsed reply is kept whole", () => {
    // Losing a customer's words is far worse than storing them untidily, and the shapes of quoted
    // mail are effectively unbounded, so the fallback is the property that matters.
    const odd = "> only quoted text, no attribution line";
    expect(stripQuotedReply(odd).length).toBeGreaterThan(0);
  });

  it("reduces HTML mail to readable text", () => {
    expect(stripQuotedReply("<p>Line one</p><p>Line two &amp; more</p>")).toBe("Line one\n\nLine two & more");
  });
});

const sentAt2 = (raw?: string) => sentAt(raw, new Date().toISOString());

describe("inbound reply timestamps", () => {
  // The receiver forwards `parsed.get("Date", "")`, so "no Date header" arrives as an EMPTY STRING
  // rather than undefined — which `?? now` does not catch. These are the shapes it really sends.
  const iso = /^\d{4}-\d{2}-\d{2}T/;

  it("accepts an RFC 2822 mail date and stores it as ISO", () => {
    // Every other `at` on a ticket is ISO; a thread sorted across both formats interleaves wrongly.
    expect(sentAt2("Tue, 5 Aug 2026 10:12:00 +0000")).toMatch(iso);
  });

  it("falls back to now on the empty string, not just on undefined", () => {
    expect(sentAt2("")).toMatch(iso);
    expect(sentAt2(undefined)).toMatch(iso);
    expect(sentAt2("not a date at all")).toMatch(iso);
  });

  it("clamps a future date", () => {
    // Attacker-controlled header: one forged Date would otherwise pin a reply to the top of the
    // thread forever.
    const stamped = new Date(sentAt2("Tue, 5 Aug 2099 10:12:00 +0000")).getTime();
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("the schedule", () => {
  it("warns before it closes", () => {
    // THE property of the whole policy: nobody may be auto-closed without having been told it was
    // coming. A reminder day equal to or past the close day would make the warning unreachable.
    for (const d of WAITING_REMINDER_DAYS) expect(d).toBeLessThan(WAITING_CLOSE_DAYS);
  });

  it("is ordered, so the last reminder is the one that carries the warning", () => {
    const sorted = [...WAITING_REMINDER_DAYS].sort((a, b) => a - b);
    expect([...WAITING_REMINDER_DAYS]).toEqual(sorted);
  });

  it("leaves time to act between the final warning and the close", () => {
    const last = WAITING_REMINDER_DAYS[WAITING_REMINDER_DAYS.length - 1]!;
    expect(WAITING_CLOSE_DAYS - last).toBeGreaterThanOrEqual(2);
  });
});

describe("tickets we cannot email", () => {
  // Two tickets in production carry metadata {source} only — they predate requester stamping
  // (added 380b2e8e, 2026-07-04). The sweep must SKIP them, never auto-close them: closing a
  // request for silence when we never had an address to ask at is closing it on someone who was
  // never asked. Asserted against the source because the sweep needs a live database.
  const sweep = readFileSync(new URL("../lib/support-mail.ts", import.meta.url), "utf8");

  it("skips a ticket with no requester email BEFORE any close decision", () => {
    // Matched on the CHECK, not the variable name: the original pinned `r.email`, and renaming
    // that shadowed variable (the reminder-day filter also bound `r`) broke the test without
    // changing the behaviour it exists to protect.
    const guard = sweep.search(/if \(!\w+\.email\)/);
    const close = sweep.indexOf("days >= WAITING_CLOSE_DAYS");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(close);
  });

  it("starts the clock from waiting_since, not from ticket creation", () => {
    // A ticket that sat in OUR queue for a week must not reach the customer already days into a
    // deadline it never told them about.
    expect(sweep).toMatch(/d\.waiting_since \?\? d\.updated_at/);
    expect(sweep).not.toMatch(/waiting_since \?\? d\.created_at/);
  });
});

describe("the sweep cannot spam or clobber", () => {
  const src = readFileSync(new URL("../lib/support-mail.ts", import.meta.url), "utf8");
  const sweep = src.slice(src.indexOf("export async function runWaitingOnUserSweep"));

  it("claims the ticket BEFORE sending, not after", () => {
    // Mailing first and writing second means a failed write re-sends "we've closed your request"
    // to the same person on every subsequent run, forever.
    const claim = sweep.indexOf(".select(\"id\")");
    const mail = sweep.indexOf("mailAutoClosed(requester");
    expect(claim).toBeGreaterThan(0);
    expect(claim).toBeLessThan(mail);
  });

  it("writes only while the ticket is still waiting on the user", () => {
    // Without this the sweep overwrites a reply that landed mid-run: status back to open plus a new
    // comment, both deleted by a blind write of data read seconds earlier.
    const guards = sweep.match(/\.eq\("data->>status", "waiting_on_user"\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);   // the close path AND the reminder path
  });

  it("refuses to close silently when it could not warn", () => {
    expect(sweep).toMatch(/if \(!who\.email\) \{ skippedNoEmail\+\+; continue; \}/);
  });

  it("reports its own cap instead of quietly dropping the tail", () => {
    expect(sweep).toMatch(/capped/);
    expect(sweep).toMatch(/console\.warn\(`\[support-sweep\] hit the/);
  });
});

describe("email rendering", () => {
  it("escapes customer text into the shell", () => {
    // Subjects and message bodies are user input, and they land inside HTML we send onward.
    const html = renderEmail({ title: "x", preheader: "p", bodyHtml: quoteBlock("You wrote", "<script>alert(1)</script>") });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("puts a preheader before any body content", () => {
    // Otherwise the inbox preview shows whatever the body starts with, which is the one line of
    // copy that decides whether the mail is opened.
    const html = renderEmail({ title: "t", preheader: "the summary line", bodyHtml: "<p>body</p>" });
    expect(html.indexOf("the summary line")).toBeLessThan(html.indexOf("<p>body</p>"));
  });

  it("renders the action as a real link, not a JS button", () => {
    const html = renderEmail({ title: "t", preheader: "p", bodyHtml: "", action: { label: "Open", url: "https://app.mondaily.com/x?a=1&b=2" } });
    expect(html).toContain('href="https://app.mondaily.com/x?a=1&amp;b=2"');
  });

  it("esc handles null and undefined without printing them", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});
