import { describe, it, expect } from "vitest";
import { flattenEnrichment } from "../jobs/enrich-record";

/**
 * Behavioural, not textual. Found in production: 28 `person` records had grown columns named after
 * the enrichment schema's `description` strings, because the model returned an object keyed by
 * description instead of by property name and the flattener preserved "any already-flat keys".
 * These are the exact keys observed in prod (2026-07-03 → 2026-07-29).
 */
const OBSERVED_LEAKED_KEYS = [
  "Verified role/profile facts from the web",
  "Estimated, derived only from the signals above",
  "Source-backed signals (role change, hiring, funding, expansion). Empty if none found.",
  "Contact details that LITERALLY appear in the web context, each with its source. Omit any you cannot find verbatim — never guess an email/phone pattern.",
];

describe("enrichment writes only keys we named", () => {
  it("drops schema descriptions returned as top-level keys", () => {
    const out = flattenEnrichment(Object.fromEntries(OBSERVED_LEAKED_KEYS.map(k => [k, { job_title: "CEO" }])));
    for (const k of OBSERVED_LEAKED_KEYS) expect(out).not.toHaveProperty(k);
  });

  it("drops descriptions nested INSIDE a recognised group too", () => {
    // The model can misread at either level; only fixing the top level would leave half the hole.
    const out = flattenEnrichment({
      professional_background: { "Verified role/profile facts from the web": "x", job_title: "CTO" },
    });
    expect(out.job_title).toBe("CTO");
    expect(Object.keys(out)).toEqual(["job_title"]);
  });

  it("still lifts every real field the schema declares", () => {
    const out = flattenEnrichment({
      professional_background: { job_title: "VP Eng", seniority: "VP", company: "Acme", location: "Berlin", linkedin: "l", twitter: "t", summary: "s" },
      company_firmographic_data: { industry: "SaaS", employee_range: "11-50", arr: 1, funding_raised: 2, founded_year: 2020, country: "DE", website: "w", description: "d" },
      verified_contact: { email: "a@b.c", phone: "+1", source: "https://x" },
      verified_intent_signals: [{ signal: "hiring", source: "https://y" }],
      calculated_churn_risk: { level: "low", rationale: "r" },
    });
    for (const k of ["job_title", "seniority", "company", "location", "linkedin", "twitter", "summary",
      "industry", "employee_range", "arr", "funding_raised", "founded_year", "country", "website", "description",
      "email", "phone", "source", "intent_signals", "churn_risk"]) {
      expect(out, `lost ${k}`).toHaveProperty(k);
    }
  });

  it("rejects any key that is prose rather than an identifier", () => {
    // Generalises past the four strings above — a NEW description would otherwise walk right in.
    const out = flattenEnrichment({ "some sentence the model invented": 1, "another. one here": 2 });
    expect(Object.keys(out)).toHaveLength(0);
  });
});
