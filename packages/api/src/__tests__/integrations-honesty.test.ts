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

describe("the catalogue describes reality", () => {
  it("marks Outlook and Google Calendar as built, because they are", () => {
    // lib/microsoft.ts is a full OAuth + Graph client; GET /integrations/calendar/events exists.
    for (const id of ["gmail", "outlook", "google-calendar"]) {
      expect(page, `${id} should be marked built`).toMatch(new RegExp(`id: "${id}"[^}]*built: true`));
    }
  });

  it("still says so plainly for what is NOT built", () => {
    expect(page).toMatch(/item\.built \? "Connect in Settings → Email" : "Not available yet"/);
    // The unbuilt ones must not have acquired a `built` flag by copy-paste.
    for (const id of ["slack", "zapier", "typeform", "mailchimp"]) {
      expect(page, `${id} must not claim to be built`).not.toMatch(new RegExp(`id: "${id}"[^}]*built: true`));
    }
  });

  it("no tile initiates a connection from this page", () => {
    // The real flow lives in Settings → Email, the only place that can show actual consent scopes.
    const catalogue = page.slice(page.indexOf("integrationCatalog.map"), page.indexOf("API keys"));
    expect(catalogue).not.toMatch(/\/integrations\/connect/);
  });
});
