import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The integrations page must not misdescribe what exists — in either direction.
 *
 * Two failures were found on 2026-08-05, opposite in sign:
 *  - /connect fell through to "google" for any unrecognised provider, so a request to connect
 *    Mailchimp or Segment answered with a GMAIL consent URL. Unreachable from today's UI, but the
 *    route is public and the first tile wired to it ships a button that lies about what it opens.
 *  - every catalogue tile except Gmail read "Not available yet", including Outlook and Google
 *    Calendar, both of which are fully built. Understating a shipped feature is the same class of
 *    error as the status page claiming Stripe needed configuring while it probed green.
 */
const route = readFileSync(join(__dirname, "../routes/integrations.ts"), "utf8");
const page = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/settings/integrations.tsx"), "utf8");

/**
 * Source with comments stripped.
 *
 * The copy assertions below are about what the page RENDERS, and the comment explaining why the
 * "Coming soon" badge was removed necessarily contains that phrase. Matching raw source failed on
 * the prose rather than the behaviour — the third time in this codebase a guard has tripped over
 * its own explanation (the design ratchet counts a hex in a comment; the auth console needed the
 * same treatment for enumeration phrasing). When a rule is about output, strip the commentary.
 */
const rendered = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("/connect never guesses a provider", () => {
  it("returns null for anything unrecognised instead of defaulting to Google", () => {
    expect(route).toMatch(/function normalizeProvider\([\s\S]{0,600}?return null;\n\}/);
    expect(route).not.toMatch(/if \(p === "imap"\) return "imap";\s*\n\s*return "google";/);
  });

  it("rejects an unknown provider with a 400 that names what IS supported", () => {
    expect(route).toMatch(/isn't a provider we connect\. Supported: google, outlook\./);
    expect(route).toMatch(/if \(!provider\) \{/);
  });
});

describe("the catalogue lists ONLY what exists", () => {
  it("carries no 'coming soon' or 'not available' copy", () => {
    // The list used to advertise Slack, Zapier, Typeform, Segment and Mailchimp with a "Coming
    // soon" badge and nothing behind any of them. A settings screen is where you go to use
    // things; a roadmap belongs on the roadmap page.
    expect(rendered).not.toMatch(/Coming soon/i);
    expect(rendered).not.toMatch(/Not available yet/i);
  });

  it("lists no integration without an implementation", () => {
    const listed = [...page.matchAll(/\{ id: "([a-z-]+)", name:/g)].map(m => m[1]!);
    expect(listed.length).toBeGreaterThan(0);
    for (const id of ["slack", "zapier", "typeform", "segment", "mailchimp"]) {
      expect(listed, `${id} has no implementation and must not be advertised`).not.toContain(id);
    }
  });

  it("every listed integration routes somewhere it can actually be connected", () => {
    // Previously the badge rendered unconditionally, so Gmail, Outlook and Google Calendar — all
    // fully built — were labelled "Coming soon" too. The page denied what it had and promised
    // what it did not.
    expect(page).toMatch(/to="\/settings\/email"/);
    expect(page).toMatch(/Connect in Settings → Email/);
  });

  it("no tile initiates a connection from this page", () => {
    // The real flow lives in Settings → Email, the only place that can show actual consent scopes.
    const catalogue = page.slice(page.indexOf("integrationCatalog.map"), page.indexOf("API keys"));
    expect(catalogue).not.toMatch(/\/integrations\/connect/);
  });
});
