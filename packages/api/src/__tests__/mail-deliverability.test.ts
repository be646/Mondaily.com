import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { quotedDisplayName } from "../lib/mail";

const SRC = join(__dirname, "..");
const mail = readFileSync(join(SRC, "lib/mail.ts"), "utf8");
const sender = readFileSync(join(SRC, "../../../deploy/mail-appliance/mail/sender.py"), "utf8");

/**
 * The first sovereign send was DELIVERED (Gmail 250 OK) but filed straight to spam. Two signals in
 * our own output explain most of it, and both are ours to fix — IP reputation is the part that only
 * time and volume can fix.
 */
describe("From carries a display name, not a bare uuid address", () => {
  it("adds a name while leaving the routing address intact", () => {
    // The address MUST stay ws-<id>@inbound.<domain> — inbound routing keys on it. Only the
    // display name is added.
    expect(mail).toMatch(/\$\{quotedDisplayName\(await workspaceDisplayName\(workspaceId\)\)\} <\$\{address\}>/);
    expect(mail).not.toMatch(/const from = inboundAddressFor\(workspaceId\) \?\? CORPORATE_FROM;/);
  });

  it("quotes the display name so a comma cannot split the header", () => {
    // "Acme, Inc." unquoted becomes TWO malformed addresses in one From.
    expect(quotedDisplayName("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(quotedDisplayName('He said "hi"')).toBe('"He said \\"hi\\""');
    expect(quotedDisplayName("back\\slash")).toBe('"back\\\\slash"');
  });

  it("never emits an empty display name, and never fails a send over one", () => {
    const fn = mail.slice(mail.indexOf("async function workspaceDisplayName"));
    expect(fn).toMatch(/let name = "Mondaily"/);          // default, not ""
    expect(fn).toMatch(/catch \{/);                        // a lookup failure must not throw
  });

  it("caches the lookup instead of querying on every send", () => {
    expect(mail).toMatch(/wsNameCache/);
    expect(mail).toMatch(/WS_NAME_TTL_MS/);
  });
});

describe("the appliance sends a real text/plain twin", () => {
  it("no longer ships a stub text part beside real HTML", () => {
    // "This message requires an HTML-capable client." next to a full HTML body is one of the
    // strongest bulk-mail signals there is — legitimate senders' parts say the same thing.
    expect(sender).not.toMatch(/set_content\("This message requires an HTML-capable client\."\)/);
    expect(sender).toMatch(/msg\.set_content\(html_to_text\(html\) if html else/);
  });

  it("keeps link URLs in the text part", () => {
    // "text <url>" was silently eaten by the tag-strip that runs after it; parentheses survive.
    expect(sender).toMatch(/r"\\2 \(\\1\)"/);
    expect(sender).not.toMatch(/r"\\2 <\\1>"/);
  });

  it("drops script/style content rather than flattening it into the body", () => {
    expect(sender).toMatch(/<\(script\|style\)/);
  });

  it("sets Reply-To when the caller supplies one", () => {
    expect(sender).toMatch(/msg\["Reply-To"\] = p\["reply_to"\]/);
  });
});
