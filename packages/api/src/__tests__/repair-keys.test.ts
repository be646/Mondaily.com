import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isSchemaDescriptionKey } from "../routes/clean";
import { flattenEnrichment } from "../lib/enrichment-fields";

const clean = readFileSync(join(__dirname, "../routes/clean.ts"), "utf8");

/**
 * /clean/repair-keys removes field names that are actually enrichment schema descriptions. The
 * danger is not the removal — it is removing the WRONG key, or throwing away what the key held.
 */
describe("only our own descriptions are treated as damage", () => {
  it("recognises every description observed in production, including truncations", () => {
    // These are the 7 distinct keys measured across person / people / contact-leads.
    for (const k of [
      "Verified role/profile facts from the web",
      "Source-backed signals (role change, hiring, funding, expansion). Empty if none found.",
      "Contact details that LITERALLY appear in the web context, each with its source. Omit any you cannot find verbatim — never guess an email/phone pattern.",
      "Estimated, derived only from the signals above",
      "Contact details that LITERALLY appear in the web context, each with its source",
      "Source-backed signals",
      "Contact details that LITERALLY appear in the web context",
    ]) {
      expect(isSchemaDescriptionKey(k), `missed: ${k}`).toBe(true);
    }
  });

  it("NEVER matches a field a user could plausibly have created", () => {
    // THE constraint on this whole endpoint. Column names are free text, so "contains a space"
    // would have deleted real user data. Every one of these has a space and must survive.
    for (const k of [
      "Job Title", "Deal Notes", "Contact details", "Next Steps", "Annual Revenue",
      "Source", "Verified", "Estimated", "signals", "Last contacted date",
      "Notes from the web", "Contact",
    ]) {
      expect(isSchemaDescriptionKey(k), `would have deleted user field: ${k}`).toBe(false);
    }
  });

  it("requires a substantial prefix, so short labels cannot collide", () => {
    // "Verified" is a prefix of a real description but far too short to be evidence.
    expect(isSchemaDescriptionKey("Verified")).toBe(false);
    expect(isSchemaDescriptionKey("Verified role/prof")).toBe(false);      // 18 chars
    expect(isSchemaDescriptionKey("Verified role/profil")).toBe(true);     // 20 chars
  });

  it("ignores ordinary schema-shaped keys and empties", () => {
    for (const k of ["job_title", "source_url", "intent_signals", "", "   "]) {
      expect(isSchemaDescriptionKey(k)).toBe(false);
    }
  });
});

describe("what the bad key contained is preserved, not discarded", () => {
  it("lifts a real nested group — the case that nearly lost data", () => {
    // Measured in production: one `people` record held
    //   "Verified role/profile facts from the web": { professional_background: { summary: "Resend is…" } }
    // and another held { company: "Notion", summary: "…" }. A blanket delete destroys both.
    expect(flattenEnrichment({ professional_background: { summary: "Resend is a developer-focused email platform" } }))
      .toEqual({ summary: "Resend is a developer-focused email platform" });
    expect(flattenEnrichment({ company: "Notion", summary: "Responsible for supporting customers" }))
      .toEqual({ company: "Notion", summary: "Responsible for supporting customers" });
  });

  it("yields nothing for the empty values that make up most of the damage", () => {
    // 40 of the 44 observed keys held {} or [] — those are pure removals.
    expect(flattenEnrichment({})).toEqual({});
    expect(flattenEnrichment({ professional_background: {} })).toEqual({});
    expect(flattenEnrichment({ email: null, job_title: null })).toEqual({});
  });
});

describe("the guards on the write", () => {
  it("is admin-only and dry-run unless explicitly opted out", () => {
    expect(clean).toMatch(/router\.post\("\/repair-keys", requireAdminRole/);
    const h = clean.slice(clean.indexOf('router.post("/repair-keys"'), clean.indexOf("// ── Record-level de-duplication"));
    expect(h).toMatch(/dry_run !== false/);
  });

  it("never overwrites a value the record already has", () => {
    const h = clean.slice(clean.indexOf('router.post("/repair-keys"'), clean.indexOf("// ── Record-level de-duplication"));
    expect(h).toMatch(/data\[sk\] == null \|\| data\[sk\] === ""/);
    expect(h).toMatch(/NEVER overwrite a real existing value/);
  });

  it("stores each removed key's ORIGINAL VALUE and aborts if the audit fails", () => {
    // Lifting recovers recognised fields; anything off-schema inside a removed key is genuinely
    // gone, so the audit must record what was there — and land before the edit.
    const h = clean.slice(clean.indexOf('router.post("/repair-keys"'), clean.indexOf("// ── Record-level de-duplication"));
    expect(h).toMatch(/removed: Object\.fromEntries/);
    expect(h.indexOf("from(\"activities\")")).toBeLessThan(h.indexOf('.update({ data: next })'));
    expect(h).toMatch(/Nothing was changed/);
  });

  it("pages the read", () => {
    const h = clean.slice(clean.indexOf('router.post("/repair-keys"'), clean.indexOf("// ── Record-level de-duplication"));
    expect(h).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
  });
});
