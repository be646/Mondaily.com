/**
 * Discovery v2 enrichment dossier — pure, tested assembly of a per-lead intelligence profile with a
 * SOURCE CITATION on every field. Nothing is fabricated: a value only appears with the real place it
 * came from (a scraped page URL, Google Places, or an existing Graph record), and `via` labels HOW
 * it was obtained ("scrape" = verbatim on the page, "ai" = extracted by the model over scraped text,
 * "places" = Google Places, "graph" = an existing workspace record). Missing fields are reported
 * honestly rather than guessed, and there are NO invented confidence numbers.
 */

export type CiteVia = "scrape" | "ai" | "places" | "graph";
export interface CitedValue { value: string; source: string; via: CiteVia }
export interface DossierPerson { name: string; role?: string | null; email?: string | null; source: string; via: CiteVia }
export interface DossierReviews { rating: number | null; count: number | null; source: string }
export interface Dossier {
  name: string;
  domain: string | null;
  summary: CitedValue | null;
  category: CitedValue | null;
  location: CitedValue | null;
  emails: CitedValue[];
  phones: CitedValue[];
  people: DossierPerson[];
  reviews: DossierReviews | null;
  graph_match: { node_id: string; name: string } | null;
  sources: { url: string; scanned: boolean }[];
  missing: string[];
  scanned: number;
}

export interface EnrichPage { url: string; text: string }
export interface AiEnrichment { people?: { name: string; role?: string; email?: string }[]; company?: string | null; category?: string | null; location?: string | null }
export interface PlacesInfo { address?: string | null; category?: string | null; rating?: number | null; reviewCount?: number | null }
export interface DossierInput {
  name: string;
  domain: string | null;
  pages: EnrichPage[];
  emails: string[];
  phones: string[];
  ai?: AiEnrichment | null;
  places?: PlacesInfo | null;
  graphMatch?: { node_id: string; name: string } | null;
}

/** The URL of the first scanned page whose text contains `value` (case-insensitive), else null. */
export function citeInPages(value: string, pages: EnrichPage[]): string | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  for (const p of pages) if ((p.text ?? "").toLowerCase().includes(needle)) return p.url;
  return null;
}

/** Assemble the dossier. Deterministic — same inputs → same output (no clock/random). */
export function buildDossier(input: DossierInput): Dossier {
  const pages = input.pages.filter(p => p.text && p.text.trim().length > 0);
  const aiSource = `AI over ${pages.length} scraped page(s)`;
  const domainFallback = input.domain ? `https://${input.domain}` : "unknown";

  // Emails / phones — cite the exact page they appear on (verbatim → via "scrape").
  const emails: CitedValue[] = input.emails.map(e => ({ value: e, via: "scrape", source: citeInPages(e, pages) ?? domainFallback }));
  const phones: CitedValue[] = input.phones.map(p => ({ value: p, via: "scrape", source: citeInPages(p, pages) ?? domainFallback }));

  // People — model-extracted from scraped text.
  const people: DossierPerson[] = (input.ai?.people ?? [])
    .filter(p => p && typeof p.name === "string" && p.name.trim())
    .map(p => ({ name: p.name, role: p.role ?? null, email: p.email ?? null, via: "ai", source: aiSource }));

  // Summary — model-extracted.
  const summary: CitedValue | null = input.ai?.company && input.ai.company.trim()
    ? { value: input.ai.company.trim(), via: "ai", source: aiSource } : null;

  // Category — prefer Places (authoritative listing), else the model.
  const category: CitedValue | null = input.places?.category
    ? { value: input.places.category, via: "places", source: "Google Places" }
    : input.ai?.category && input.ai.category.trim()
      ? { value: input.ai.category.trim(), via: "ai", source: aiSource } : null;

  // Location — prefer Places address, else the model.
  const location: CitedValue | null = input.places?.address
    ? { value: input.places.address, via: "places", source: "Google Places" }
    : input.ai?.location && input.ai.location.trim()
      ? { value: input.ai.location.trim(), via: "ai", source: aiSource } : null;

  // Reviews/ratings — only from Places, only when a real rating exists.
  const reviews: DossierReviews | null = (input.places && typeof input.places.rating === "number")
    ? { rating: input.places.rating, count: input.places.reviewCount ?? null, source: "Google Places" } : null;

  const graph_match = input.graphMatch ?? null;

  // Honest "what we couldn't find" — for the UI's missing-fields hint.
  const missing: string[] = [];
  if (!summary) missing.push("summary");
  if (!category) missing.push("category");
  if (!location) missing.push("location");
  if (emails.length === 0) missing.push("emails");
  if (phones.length === 0) missing.push("phones");
  if (!reviews) missing.push("reviews");

  return {
    name: input.name,
    domain: input.domain,
    summary, category, location, emails, phones, people, reviews, graph_match,
    sources: pages.map(p => ({ url: p.url, scanned: true })),
    missing,
    scanned: pages.length,
  };
}
