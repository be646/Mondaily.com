import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDossier, citeInPages, type DossierInput } from "../lib/discovery-dossier";

const pages = [
  { url: "https://acme.com", text: "Acme builds widgets. Call us." },
  { url: "https://acme.com/contact", text: "Email hello@acme.com or call +1 415 555 0000 in San Francisco." },
];

describe("citeInPages — maps a value to the page it appears on", () => {
  it("returns the first page whose text contains the value (case-insensitive)", () => {
    expect(citeInPages("hello@acme.com", pages)).toBe("https://acme.com/contact");
    expect(citeInPages("ACME BUILDS", pages)).toBe("https://acme.com");
  });
  it("returns null when the value appears nowhere", () => {
    expect(citeInPages("nowhere@x.com", pages)).toBeNull();
    expect(citeInPages("", pages)).toBeNull();
  });
});

describe("buildDossier — citations on every field, nothing fabricated", () => {
  const base: DossierInput = {
    name: "Acme", domain: "acme.com", pages,
    emails: ["hello@acme.com"], phones: ["+1 415 555 0000"],
    ai: { people: [{ name: "Jane Doe", role: "CEO" }], company: "Builds widgets", category: "manufacturer", location: "SF" },
    places: null, graphMatch: null,
  };

  it("cites emails/phones to the exact scraped page (via scrape)", () => {
    const d = buildDossier(base);
    expect(d.emails[0]).toEqual({ value: "hello@acme.com", via: "scrape", source: "https://acme.com/contact" });
    expect(d.phones[0].via).toBe("scrape");
    expect(d.phones[0].source).toBe("https://acme.com/contact");
  });
  it("labels AI-extracted summary/people as via 'ai' with the page-count source", () => {
    const d = buildDossier(base);
    expect(d.summary).toEqual({ value: "Builds widgets", via: "ai", source: "AI over 2 scraped page(s)" });
    expect(d.people[0]).toMatchObject({ name: "Jane Doe", role: "CEO", via: "ai" });
  });
  it("prefers Google Places for category/location/reviews when present (via places)", () => {
    const d = buildDossier({ ...base, places: { address: "1 Main St, SF", category: "Dental clinic", rating: 4.6, reviewCount: 210 } });
    expect(d.category).toEqual({ value: "Dental clinic", via: "places", source: "Google Places" });
    expect(d.location).toEqual({ value: "1 Main St, SF", via: "places", source: "Google Places" });
    expect(d.reviews).toEqual({ rating: 4.6, count: 210, source: "Google Places" });
  });
  it("reviews stay NULL when Places has no rating (never a fake score)", () => {
    expect(buildDossier(base).reviews).toBeNull();
    expect(buildDossier({ ...base, places: { address: null, category: null, rating: null, reviewCount: null } }).reviews).toBeNull();
  });
  it("surfaces a graph match (via graph)", () => {
    const d = buildDossier({ ...base, graphMatch: { node_id: "n1", name: "Acme" } });
    expect(d.graph_match).toEqual({ node_id: "n1", name: "Acme" });
  });
  it("reports missing fields honestly instead of guessing", () => {
    const d = buildDossier({ name: "Empty", domain: "empty.com", pages: [{ url: "https://empty.com", text: "nothing useful here" }], emails: [], phones: [], ai: {}, places: null });
    expect(d.summary).toBeNull();
    expect(d.reviews).toBeNull();
    expect(d.missing).toEqual(expect.arrayContaining(["summary", "category", "location", "emails", "phones", "reviews"]));
  });
  it("no source/confidence numbers are invented — every value carries only a real source string", () => {
    const d = buildDossier(base);
    for (const e of [...d.emails, ...d.phones]) expect(typeof e.source).toBe("string");
    expect(JSON.stringify(d)).not.toMatch(/confidence/i); // dossier never emits a confidence field
  });
});

describe("enrich route wiring (source-read)", () => {
  const src = readFileSync(fileURLToPath(new URL("../routes/discovery.ts", import.meta.url)), "utf8");
  it("enrich builds the dossier and is workspace-scoped for the graph match", () => {
    expect(src).toMatch(/buildDossier\(\{ name: name \?\? domain/);
    expect(src).toMatch(/from\("nodes"\)\.select\("id, data"\)\.eq\("workspace_id", workspaceId\)/);
  });
  it("existing save/lead-task/lead-decision endpoints remain", () => {
    expect(src).toMatch(/router\.post\("\/save"/);
    expect(src).toMatch(/router\.post\("\/lead-task"/);
    expect(src).toMatch(/router\.post\("\/lead-decision"/);
  });
});
