/**
 * Clean a discovered lead before it becomes a row in a sheet.
 *
 * Discovery scrapes the open web, so what comes back is real but MESSY: names padded with
 * whitespace and marketing suffixes, URLs carrying utm tracking, phone numbers in a dozen shapes,
 * and emails that are not emails. Saved verbatim, a sheet that is supposed to be a work queue turns
 * into something you have to tidy before you can use — which is how a lead list quietly becomes
 * nobody's job.
 *
 * MEASURED against the existing rows on 2026-08-14: `source_url` values ending
 * `?utm_source=google...`, a row with `region: Warsaw` next to `country: Albania`, names truncated
 * mid-word by upstream scraping.
 *
 * TWO RULES, and they are different jobs:
 *
 *   CLEAN  — normalise what is there. Never invent, never guess. A field we cannot parse is
 *            dropped, not repaired, because a plausible-looking wrong phone number is worse than
 *            an empty one.
 *   FILTER — decide whether this is a lead at all. Something with no name, or with no way to
 *            contact it, is not a lead; it is noise that makes the real ones harder to see.
 *
 * Pure and dependency-free so both the single save and the batch save share exactly one definition
 * — a rule applied at one call site is not a rule.
 */

export interface RawLead {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  source_url?: string;
  handle?: string;
  region?: string;
  summary?: string;
}

export interface CleanLead {
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  source_url?: string;
  handle?: string;
  region?: string;
  summary?: string;
}

/** Collapse runs of whitespace and trim — scraped text arrives full of newlines and doubled spaces. */
const tidy = (v?: string): string => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Tracking parameters carry no information about the lead and make two records of the same business
 * look different, which defeats de-duplication.
 */
const TRACKING = /^(utm_[a-z_]+|gclid|fbclid|mc_[a-z]+|ref|source|campaign_id|igshid)$/i;

export function cleanUrl(raw?: string): string | undefined {
  const s = tidy(raw);
  if (!s) return undefined;
  // A scheme we do not accept must be REJECTED, not prefixed. Blindly prepending https:// turned
  // "mailto:a@b.com" into the parseable-but-nonsense "https://mailto:a@b.com".
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return undefined;
  try {
    const u = new URL(scheme ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol)) return undefined;
    // A hostname with no dot is not a domain — "bad" parsed happily as https://bad.
    if (!u.hostname.includes(".")) return undefined;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    let out = u.toString();
    // A bare host reads better without its trailing slash; a real path keeps its shape.
    if (u.pathname === "/" && !u.search) out = out.replace(/\/$/, "");
    return out;
  } catch { return undefined; }
}

/** Lowercased and shape-checked. An "email" that cannot be one is dropped rather than stored. */
export function cleanEmail(raw?: string): string | undefined {
  const s = tidy(raw).toLowerCase();
  if (!s) return undefined;
  // Deliberately simple: this rejects the junk scraping produces, and does not try to out-guess RFC 5322.
  return /^[^\s@,;]+@[^\s@,;.]+\.[a-z]{2,}$/.test(s) ? s : undefined;
}

/**
 * Digits, and a leading + when the source had one. Formatting is stripped because the same number
 * written three ways is three rows to a de-duplicator.
 */
export function cleanPhone(raw?: string): string | undefined {
  const s = tidy(raw);
  if (!s) return undefined;
  const plus = s.trimStart().startsWith("+");
  const digits = s.replace(/\D/g, "");
  // Below 7 digits it is an extension or a scraping artefact, not a reachable number.
  if (digits.length < 7 || digits.length > 15) return undefined;
  return (plus ? "+" : "") + digits;
}

/** Marketing tails that scraping picks up and that make two records of one business look different. */
const NAME_NOISE = /\s*[|·—–-]\s*(home|homepage|official site|official website|welcome)\s*$/i;

export function cleanName(raw?: string): string | undefined {
  let s = tidy(raw).replace(NAME_NOISE, "").trim();
  // Scraped titles often end mid-punctuation.
  s = s.replace(/[|·,;:\-–—]+$/, "").trim();
  return s || undefined;
}

/**
 * Is this a lead worth putting in front of someone?
 *
 * A name alone is not: without an email, a phone, a website or the page it came from, there is
 * nothing to act on. Such rows do not get "cleaned up later" — they sit in the sheet making the
 * real leads harder to find.
 */
export function isUsableLead(l: CleanLead): boolean {
  if (!l.name) return false;
  return Boolean(l.email || l.phone || l.website || l.source_url);
}

export function cleanLead(raw: RawLead): { lead: CleanLead; usable: boolean; dropped: string[] } {
  const dropped: string[] = [];
  const keep = <T,>(field: string, before: string | undefined, after: T | undefined): T | undefined => {
    if (before && !after) dropped.push(field);
    return after;
  };

  const lead: CleanLead = {
    name: cleanName(raw.name) ?? "",
    email: keep("email", tidy(raw.email) || undefined, cleanEmail(raw.email)),
    phone: keep("phone", tidy(raw.phone) || undefined, cleanPhone(raw.phone)),
    website: keep("website", tidy(raw.website) || undefined, cleanUrl(raw.website)),
    source_url: keep("source_url", tidy(raw.source_url) || undefined, cleanUrl(raw.source_url)),
    handle: tidy(raw.handle) || undefined,
    region: tidy(raw.region) || undefined,
    summary: tidy(raw.summary).slice(0, 1000) || undefined,
  };

  return { lead, usable: isUsableLead(lead), dropped };
}
