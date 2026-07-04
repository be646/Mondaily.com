/**
 * WORKSPACE PROFILE — the industry-aware personalization layer.
 *
 * Mondaily stays a general "AI-native autonomous workspace and asset-graph engine". The profile does
 * NOT specialize the product — it only tunes EXAMPLES, TERMS and DEFAULTS (Discovery examples, Ask
 * starter prompts, injected AI context, onboarding output). Everything is data-driven off the
 * profile fields; the small preset table below is a starting point, and any unknown industry still
 * gets sensible suggestions generated from the profile data via generic templates.
 *
 * Backward-compatible: existing workspaces have no `settings.profile`. resolveProfile() derives one
 * from the legacy onboarding fields (industry, goals, discovery_icp.description, region) so nothing
 * breaks and old workspaces still get relevant suggestions.
 */

export type AiHelpLevel = "low" | "balanced" | "high";

export interface WorkspaceProfile {
  industry: string;                 // free text, e.g. "Aesthetic clinics", "Commercial real estate"
  business_model: string;           // e.g. "B2B services", "B2C ecommerce", "Marketplace"
  target_customers: string;         // who they sell to / serve
  main_objects_tracked: string[];   // the records that matter, e.g. ["clinics","patients","follow-ups"]
  preferred_terms: Record<string, string>; // rename generic terms, e.g. { "deal": "case", "contact": "patient" }
  primary_goals: string[];          // e.g. ["book more consultations","reduce no-shows"]
  region: string;                   // e.g. "London", "Poland", "US Northeast"
  language: string;                 // BCP-47-ish or plain, e.g. "en", "pl"
  tone: string;                     // e.g. "professional", "friendly", "concise"
  discovery_focus: string;          // what Discovery should hunt for, e.g. "clinics with poor reviews"
  ai_help_level: AiHelpLevel;       // how proactive/verbose the AI should be
}

/** A completely empty profile — every field blank. Used as the base to merge partial data onto. */
export const EMPTY_PROFILE: WorkspaceProfile = {
  industry: "",
  business_model: "",
  target_customers: "",
  main_objects_tracked: [],
  preferred_terms: {},
  primary_goals: [],
  region: "",
  language: "en",
  tone: "professional",
  discovery_focus: "",
  ai_help_level: "balanced",
};

/** True when the profile carries enough signal to personalize (has an industry or a Discovery focus
 *  or target customers). Empty/near-empty profiles fall back to neutral generic suggestions. */
export function hasProfileSignal(p: WorkspaceProfile): boolean {
  return Boolean(p.industry.trim() || p.discovery_focus.trim() || p.target_customers.trim() || p.main_objects_tracked.length);
}

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Resolve the workspace profile from raw `settings`. Prefers an explicit `settings.profile`, and
 * fills any gaps from the legacy onboarding fields so existing workspaces are personalized too.
 */
export function resolveProfile(settings: Record<string, unknown> | null | undefined): WorkspaceProfile {
  const s = settings ?? {};
  const stored = (s.profile ?? {}) as Partial<WorkspaceProfile>;
  const icp = (s.discovery_icp ?? {}) as { description?: string };

  const legacyGoals = asArr(s.goals);
  const level = asStr(stored.ai_help_level) as AiHelpLevel;

  return {
    industry: asStr(stored.industry) || asStr(s.industry) || asStr(s.industry_vertical),
    business_model: asStr(stored.business_model) || asStr(s.business_model),
    target_customers: asStr(stored.target_customers) || asStr(icp.description),
    main_objects_tracked: stored.main_objects_tracked?.length ? asArr(stored.main_objects_tracked) : [],
    preferred_terms: (stored.preferred_terms && typeof stored.preferred_terms === "object" ? stored.preferred_terms : {}) as Record<string, string>,
    primary_goals: stored.primary_goals?.length ? asArr(stored.primary_goals) : legacyGoals,
    region: asStr(stored.region) || asStr(s.region),
    language: asStr(stored.language) || asStr(s.language) || "en",
    tone: asStr(stored.tone) || "professional",
    discovery_focus: asStr(stored.discovery_focus) || asStr(icp.description),
    ai_help_level: ["low", "balanced", "high"].includes(level) ? level : "balanced",
  };
}

/** Merge a partial profile patch onto an existing one, keeping unspecified fields intact. */
export function mergeProfile(base: WorkspaceProfile, patch: Partial<WorkspaceProfile>): WorkspaceProfile {
  return {
    ...base,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
  } as WorkspaceProfile;
}

// ── Industry families ────────────────────────────────────────────────────────────────────────
// A tiny keyword→family map. This is deliberately small: unknown industries fall through to the
// generic templates, which build suggestions from the profile fields themselves.
export type IndustryFamily =
  | "healthcare" | "real_estate" | "agency" | "ecommerce" | "saas" | "recruiting" | "hospitality" | "generic";

const FAMILY_KEYWORDS: Array<[IndustryFamily, RegExp]> = [
  ["healthcare", /clinic|health|medical|dental|patient|aesthetic|wellness|therapy|pharma/i],
  ["real_estate", /real ?estate|property|realtor|broker|landlord|investor|housing|mortgage/i],
  ["agency", /agency|marketing|creative|consult|studio|freelanc|services firm/i],
  ["ecommerce", /ecommerce|e-commerce|retail|shop|store|dtc|d2c|cosmetic|skin ?care|fashion|brand/i],
  ["saas", /saas|software|b2b tech|platform|app|startup|developer tool/i],
  ["recruiting", /recruit|staffing|talent|hr|hiring|headhunt/i],
  ["hospitality", /hotel|restaurant|hospitality|travel|event|catering|venue/i],
];

/** Normalize a free-text industry to a family bucket. Falls back to "generic". */
export function industryFamily(industry: string): IndustryFamily {
  const text = industry.trim();
  if (!text) return "generic";
  for (const [family, re] of FAMILY_KEYWORDS) if (re.test(text)) return family;
  return "generic";
}

// Per-family flavor: canonical object nouns + a few example templates. `{region}` and `{who}` are
// filled from the profile at generation time. Kept small on purpose — generic templates cover the rest.
interface FamilyFlavor {
  objects: string[];
  terms: Record<string, string>;
  discovery: string[];
  ask: string[];
}
const FAMILY_FLAVOR: Record<IndustryFamily, FamilyFlavor> = {
  healthcare: {
    objects: ["clinics", "patients", "follow-ups"],
    terms: { contact: "patient", deal: "case", pipeline: "care pipeline" },
    discovery: ["Find clinics in {region} with poor reviews", "Find {who} not yet using a booking system"],
    ask: ["Track patient follow-ups", "Show overdue clinic tasks", "Which patients haven't been contacted in 30 days?"],
  },
  real_estate: {
    objects: ["properties", "owners", "investors"],
    terms: { contact: "owner", deal: "listing", pipeline: "deal pipeline" },
    discovery: ["Find property owners in {region}", "Find {who} with listings older than 60 days"],
    ask: ["Track investor follow-ups", "Show stale opportunities", "Which listings need a price review?"],
  },
  agency: {
    objects: ["clients", "projects", "deliverables"],
    terms: { deal: "project", pipeline: "client pipeline" },
    discovery: ["Find companies hiring agencies in {region}", "Find {who} actively spending on ads"],
    ask: ["Show client work at risk", "Draft a follow-up for overdue deliverables", "Which retainers renew this month?"],
  },
  ecommerce: {
    objects: ["stores", "suppliers", "wholesale leads"],
    terms: { contact: "buyer", deal: "order" },
    discovery: ["Find {who} in {region} without wholesale pricing", "Find retailers stocking similar products"],
    ask: ["Show wholesale leads to follow up", "Which stockists haven't reordered?", "Draft an outreach to new retailers"],
  },
  saas: {
    objects: ["accounts", "champions", "opportunities"],
    terms: { contact: "champion" },
    discovery: ["Find companies in {region} using a competitor", "Find {who} that recently raised funding"],
    ask: ["Show opportunities with no activity in 2 weeks", "Which trials are expiring soon?", "Draft a re-engagement email"],
  },
  recruiting: {
    objects: ["candidates", "roles", "clients"],
    terms: { contact: "candidate", deal: "placement" },
    discovery: ["Find companies in {region} hiring for {who}", "Find candidates with skills in ..."],
    ask: ["Show roles waiting on candidates", "Which placements need follow-up?", "Draft a candidate outreach"],
  },
  hospitality: {
    objects: ["venues", "guests", "events"],
    terms: { deal: "booking", contact: "guest" },
    discovery: ["Find event planners in {region}", "Find {who} without online booking"],
    ask: ["Show upcoming bookings needing confirmation", "Which venues have open dates?", "Draft a follow-up to past guests"],
  },
  generic: {
    objects: ["companies", "contacts", "opportunities"],
    terms: {},
    discovery: ["Find {who} in {region}", "Find companies matching your ideal customer"],
    ask: ["Show opportunities with no recent activity", "Summarize what needs attention today", "Draft a follow-up for a stalled deal"],
  },
};

function fill(template: string, p: WorkspaceProfile): string {
  const region = p.region.trim() || "your region";
  const who = p.target_customers.trim() || p.discovery_focus.trim() || "your ideal customers";
  return template.replace(/\{region\}/g, region).replace(/\{who\}/g, who).trim();
}

function dedupe(list: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (s && !seen.has(k)) { seen.add(k); out.push(s); }
    if (out.length >= limit) break;
  }
  return out;
}

/** Canonical object nouns for the workspace — explicit profile list wins, else the family default. */
export function profileObjects(p: WorkspaceProfile): string[] {
  if (p.main_objects_tracked.length) return p.main_objects_tracked;
  return FAMILY_FLAVOR[industryFamily(p.industry)].objects;
}

/** Merge of the family's term overrides and any explicit preferred_terms (explicit wins). */
export function profileTerms(p: WorkspaceProfile): Record<string, string> {
  return { ...FAMILY_FLAVOR[industryFamily(p.industry)].terms, ...p.preferred_terms };
}

/**
 * Discovery search examples tuned to the profile. Family templates first, then a discovery_focus /
 * target-customer line, then generic fallbacks — always returns `limit` neutral-or-better examples,
 * so an empty profile still yields sensible generic prompts.
 */
export function discoverySuggestions(p: WorkspaceProfile, limit = 4): string[] {
  const family = industryFamily(p.industry);
  const out: string[] = [];
  if (p.discovery_focus.trim()) out.push(fill(`Find ${p.discovery_focus.trim()} in {region}`, p));
  out.push(...FAMILY_FLAVOR[family].discovery.map((t) => fill(t, p)));
  if (family !== "generic") out.push(...FAMILY_FLAVOR.generic.discovery.map((t) => fill(t, p)));
  return dedupe(out, limit);
}

/** Ask starter prompts tuned to the profile (family + goals), with generic fallbacks. */
export function askStarterPrompts(p: WorkspaceProfile, limit = 4): string[] {
  const family = industryFamily(p.industry);
  const out: string[] = [];
  for (const g of p.primary_goals.slice(0, 2)) out.push(`Help me ${g.replace(/^to\s+/i, "")}`);
  out.push(...FAMILY_FLAVOR[family].ask);
  if (family !== "generic") out.push(...FAMILY_FLAVOR.generic.ask);
  return dedupe(out, limit);
}

/**
 * Compact context lines describing the workspace, to inject into an AI system prompt. Only includes
 * fields that are set. Returns [] for an empty profile (so nothing misleading is injected).
 * IMPORTANT for callers: this is CONTEXT for tone/relevance only — the AI must still never invent data.
 */
export function profileContextLines(p: WorkspaceProfile): string[] {
  const lines: string[] = [];
  if (p.industry) lines.push(`Industry: ${p.industry}`);
  if (p.business_model) lines.push(`Business model: ${p.business_model}`);
  if (p.target_customers) lines.push(`Target customers: ${p.target_customers}`);
  if (p.primary_goals.length) lines.push(`Primary goals: ${p.primary_goals.join("; ")}`);
  if (p.region) lines.push(`Primary region: ${p.region}`);
  if (p.language && p.language !== "en") lines.push(`Preferred language: ${p.language}`);
  const terms = Object.entries(profileTerms(p));
  if (terms.length) lines.push(`Preferred terminology: ${terms.map(([k, v]) => `"${k}" → "${v}"`).join(", ")}`);
  if (p.tone) lines.push(`Tone: ${p.tone}`);
  return lines;
}

/** Single-block workspace-context string for a system prompt. Empty string unless the profile has
 *  REAL signal (industry / customers / goals / region / model / terms) — so a blank profile never
 *  injects a lone "Tone" line that adds noise without value. */
export function profileContextBlock(p: WorkspaceProfile): string {
  const hasContext = hasProfileSignal(p) || p.primary_goals.length > 0 || Boolean(p.region.trim()) ||
    Boolean(p.business_model.trim()) || Object.keys(p.preferred_terms).length > 0;
  if (!hasContext) return "";
  const lines = profileContextLines(p);
  if (!lines.length) return "";
  return `Workspace context (use for relevance and terminology — never fabricate data):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
