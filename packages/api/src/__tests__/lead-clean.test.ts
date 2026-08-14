import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanLead, cleanUrl, cleanEmail, cleanPhone, cleanName, isUsableLead } from "../lib/lead-clean";

/**
 * Discovery scrapes the open web, so what comes back is real but MESSY. Saved verbatim, a sheet
 * meant to be a work queue becomes something you must tidy before you can use it.
 *
 * MEASURED against the rows already in the sheet on 2026-08-14: source_urls ending
 * "?utm_source=google…", names truncated mid-word, a row with region "Warsaw" beside country
 * "Albania".
 */
describe("a scraped lead is cleaned before it becomes a row", () => {
  it("strips tracking parameters that defeat de-duplication", () => {
    // Two records of the same business must not look different because one carried a utm tag.
    expect(cleanUrl("https://skinbodycare.pl/?utm_source=google&utm_medium=cpc")).toBe("https://skinbodycare.pl");
    expect(cleanUrl("https://x.com/page?utm_campaign=a&id=7")).toBe("https://x.com/page?id=7");
  });

  it("normalises the host so www and case do not create duplicates", () => {
    expect(cleanUrl("http://WWW.DullLawOffices.com/")).toBe("http://dulllawoffices.com");
    expect(cleanUrl("dulllawoffices.com")).toBe("https://dulllawoffices.com");
  });

  it("refuses a non-http scheme rather than storing it", () => {
    // javascript: and mailto: in a website field are scraping artefacts, not sites.
    expect(cleanUrl("javascript:alert(1)")).toBeUndefined();
    expect(cleanUrl("mailto:a@b.com")).toBeUndefined();
    expect(cleanUrl("not a url at all")).toBeUndefined();
  });

  it("drops an email that cannot be one instead of repairing it", () => {
    // A plausible-looking wrong value is worse than an empty field.
    expect(cleanEmail("  Info@Clinic.PL ")).toBe("info@clinic.pl");
    expect(cleanEmail("info@clinic")).toBeUndefined();
    expect(cleanEmail("two@a.com, three@b.com")).toBeUndefined();
    expect(cleanEmail("not-an-email")).toBeUndefined();
  });

  it("reduces a phone number to something comparable", () => {
    expect(cleanPhone("+48 606 505 801")).toBe("+48606505801");
    expect(cleanPhone("(660) 438-7102")).toBe("6604387102");
    // Too short to be reachable — an extension or an artefact.
    expect(cleanPhone("123")).toBeUndefined();
    expect(cleanPhone("+1 800 CALL NOW")).toBeUndefined();
  });

  it("trims the marketing tail off a scraped name", () => {
    expect(cleanName("  Loving   Social Media  ")).toBe("Loving Social Media");
    expect(cleanName("Acme Clinic | Home")).toBe("Acme Clinic");
    expect(cleanName("Acme Clinic - Official Site")).toBe("Acme Clinic");
    expect(cleanName("Dull Law, LLC (formerly Kjar Law Office,")).toBe("Dull Law, LLC (formerly Kjar Law Office");
  });

  it("keeps a lead only when there is a way to act on it", () => {
    // A name with no contact route is not a lead; it is noise that hides the real ones.
    expect(isUsableLead({ name: "Acme" })).toBe(false);
    expect(isUsableLead({ name: "Acme", phone: "+48606505801" })).toBe(true);
    expect(isUsableLead({ name: "Acme", source_url: "https://acme.com" })).toBe(true);
    expect(isUsableLead({ name: "", email: "a@b.com" })).toBe(false);
  });

  it("reports what it dropped, so nothing disappears silently", () => {
    const { lead, usable, dropped } = cleanLead({
      name: "  Acme Clinic | Home ",
      email: "nonsense",
      phone: "12",
      website: "https://acme.pl/?utm_source=x",
      source_url: "https://maps.google.com/place/1",
    });
    expect(lead.name).toBe("Acme Clinic");
    expect(lead.website).toBe("https://acme.pl");
    expect(lead.email).toBeUndefined();
    expect(lead.phone).toBeUndefined();
    expect(dropped.sort()).toEqual(["email", "phone"]);
    expect(usable).toBe(true);
  });

  it("never invents a value it could not parse", () => {
    // The whole point: clean normalises, it does not repair.
    const { lead } = cleanLead({ name: "Acme", email: "bad", phone: "bad", website: "bad" });
    expect(lead.email).toBeUndefined();
    expect(lead.phone).toBeUndefined();
    expect(lead.website).toBeUndefined();
  });

  it("bounds the summary rather than storing a whole scraped page", () => {
    const { lead } = cleanLead({ name: "Acme", phone: "+48606505801", summary: "x".repeat(5000) });
    expect((lead.summary ?? "").length).toBeLessThanOrEqual(1000);
  });
});

/**
 * Wiring. "All discovery leads should go after save to the discovered leads sheet automatically,
 * and be automatically filtered and cleaned."
 */
describe("discovery saves into the Discovered leads sheet, cleaned", () => {
  const API = readFileSync(join(__dirname, "../routes/discovery.ts"), "utf8");
  const UI = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/discovery.tsx"), "utf8");

  it("saves to the discovered-leads sheet, not Companies", () => {
    // Every save path sent object_type "company", so leads landed in the Companies sheet while the
    // Discovered leads sheet the sidebar shows was fed by something else entirely.
    expect(UI, "no save may still target the Companies sheet").not.toMatch(/object_type: "company"/);
    expect((UI.match(/object_type: "discovered-leads"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("cleans on the way in, through ONE shared function", () => {
    // Two save paths with two standards is how a sheet ends up half tidy — and "Save all" is the
    // one people actually use.
    expect(API).toMatch(/import \{ cleanLead \}/);
    expect((API.match(/cleanLead\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("REFUSES a row with nothing to act on, and says so", () => {
    expect(API).toMatch(/a lead needs a name and at least one of email, phone, website or source/);
    expect(API).toMatch(/\}, 422\)/);
  });

  it("reports what a batch refused instead of dropping it silently", () => {
    // A batch that saves 12 of 40 while reporting 40 is worse than one that says what it refused.
    expect(API).toMatch(/const rejected = cleanedAll\.filter/);
    expect((API.match(/rejected \}/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
