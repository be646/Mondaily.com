// Mock corporate enrichment data — keyed by normalised company name
const DB: Record<string, Record<string, unknown>> = {
  stripe:      { arr: 1_400_000_000, funding_raised: 2_200_000_000, employee_range: "1000-5000", country: "USA",     description: "Payment infrastructure for the internet" },
  vercel:      { arr: 110_000_000,   funding_raised: 313_000_000,   employee_range: "500-1000",  country: "USA",     description: "Frontend cloud platform for web teams" },
  linear:      { arr: 35_000_000,    funding_raised: 52_000_000,    employee_range: "100-250",   country: "USA",     description: "Modern project management for software teams" },
  notion:      { arr: 300_000_000,   funding_raised: 343_000_000,   employee_range: "500-1000",  country: "USA",     description: "All-in-one workspace for notes and docs" },
  figma:       { arr: 600_000_000,   funding_raised: 332_900_000,   employee_range: "500-1000",  country: "USA",     description: "Collaborative design tool for product teams" },
  supabase:    { arr: 30_000_000,    funding_raised: 116_000_000,   employee_range: "100-250",   country: "USA",     description: "Open-source Firebase alternative" },
  loom:        { arr: 45_000_000,    funding_raised: 203_000_000,   employee_range: "250-500",   country: "USA",     description: "Async video messaging for teams" },
  retool:      { arr: 80_000_000,    funding_raised: 145_000_000,   employee_range: "250-500",   country: "USA",     description: "Low-code internal tool builder" },
  planetscale: { arr: 18_000_000,    funding_raised: 105_000_000,   employee_range: "50-100",    country: "USA",     description: "Serverless MySQL platform" },
  clerk:       { arr: 20_000_000,    funding_raised: 55_000_000,    employee_range: "50-100",    country: "USA",     description: "Authentication & user management" },
  resend:      { arr: 8_000_000,     funding_raised: 6_800_000,     employee_range: "11-50",     country: "USA",     description: "Email API for developers" },
  railway:     { arr: 12_000_000,    funding_raised: 25_000_000,    employee_range: "11-50",     country: "USA",     description: "Instant cloud deployment platform" },
  miro:        { arr: 400_000_000,   funding_raised: 476_000_000,   employee_range: "1000-5000", country: "Netherlands", description: "Online collaborative whiteboard" },
  descript:    { arr: 22_000_000,    funding_raised: 100_000_000,   employee_range: "100-250",   country: "USA",     description: "Collaborative audio and video editing" },
  hex:         { arr: 14_000_000,    funding_raised: 56_000_000,    employee_range: "50-100",    country: "USA",     description: "Collaborative data workspace" },
  airbyte:     { arr: 25_000_000,    funding_raised: 181_000_000,   employee_range: "250-500",   country: "USA",     description: "Open-source data integration platform" },
  hasura:      { arr: 30_000_000,    funding_raised: 100_000_000,   employee_range: "100-250",   country: "India",   description: "Instant GraphQL API engine" },
  tally:       { arr: 5_000_000,     funding_raised: 2_100_000,     employee_range: "11-50",     country: "Belgium", description: "Beautiful free form builder" },
  raycast:     { arr: 15_000_000,    funding_raised: 30_000_000,    employee_range: "50-100",    country: "USA",     description: "Blazingly fast productivity launcher" },
  calcom:      { arr: 6_000_000,     funding_raised: 32_000_000,    employee_range: "50-100",    country: "USA",     description: "Open-source scheduling infrastructure" },
  innova:      { arr: 5_000_000,     funding_raised: 2_000_000,     employee_range: "11-50",     country: "USA",     description: "Technology startup" },
  mondaily:    { arr: 1_000_000,     funding_raised: 500_000,       employee_range: "1-10",      country: "UAE",     description: "AI-powered CRM platform" },
};

function normalise(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function generateMock(name: string): Record<string, unknown> {
  // Deterministic pseudo-random values based on name hash so they stay stable
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const abs = Math.abs(h);
  const ranges = ["1-10", "11-50", "51-200", "201-500", "500-1000"];
  const countries = ["USA", "UK", "Germany", "France", "Canada", "Australia", "Singapore"];
  return {
    arr:             (abs % 90 + 1) * 1_000_000,
    funding_raised:  (abs % 200 + 1) * 500_000,
    employee_range:  ranges[abs % ranges.length],
    country:         countries[abs % countries.length],
    description:     `${name} — innovative B2B software company`,
  };
}

export interface EnrichmentResult {
  fields: Record<string, unknown>;
  source: "known" | "generated";
}

/** Simulate async enrichment with a realistic delay. */
export async function enrichCompany(name: string): Promise<EnrichmentResult> {
  const delay = 1500 + Math.random() * 1000;
  await new Promise(r => setTimeout(r, delay));

  const key = normalise(name);
  const exact = DB[key];
  if (exact) return { fields: exact, source: "known" };

  const partial = Object.keys(DB).find(k => k.includes(key) || key.includes(k));
  if (partial) return { fields: DB[partial], source: "known" };

  return { fields: generateMock(name), source: "generated" };
}

export async function enrichPerson(email: string): Promise<EnrichmentResult> {
  const delay = 1200 + Math.random() * 800;
  await new Promise(r => setTimeout(r, delay));

  const domain = email.split("@")[1]?.split(".")[0] ?? "";
  const companyData = DB[normalise(domain)];
  return {
    fields: {
      company: domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : undefined,
      ...(companyData ? { linkedin: `linkedin.com/company/${domain}` } : {}),
    },
    source: companyData ? "known" : "generated",
  };
}

// ── NLP command parser ────────────────────────────────────────────────────────

export interface ParsedCommand {
  filterText?: string;
  sortCol?: string;
  sortDir?: "asc" | "desc";
  calcOps?: Record<string, "sum" | "avg" | "min" | "max" | "count">;
  raw: string;
  confidence: number;
}

const COL_ALIASES: Record<string, string[]> = {
  arr:             ["arr", "revenue", "annual revenue", "annual recurring"],
  funding_raised:  ["funding", "raised", "funding raised"],
  employee_range:  ["employees", "employee", "team size", "headcount"],
  country:         ["country", "location", "region", "where"],
  deal_value:      ["deal value", "deal size", "value", "amount"],
  deal_stage:      ["stage", "deal stage", "status"],
  deal_owner:      ["owner", "deal owner", "rep", "assigned"],
  email:           ["email", "mail"],
  job_title:       ["title", "job", "role", "position"],
};

function resolveCol(fragment: string): string | undefined {
  const f = fragment.toLowerCase();
  for (const [col, aliases] of Object.entries(COL_ALIASES)) {
    if (aliases.some(a => f.includes(a))) return col;
  }
  return undefined;
}

export function parseNLPCommand(input: string, availableColumns: string[]): ParsedCommand {
  const text = input.toLowerCase().trim();
  const result: ParsedCommand = { raw: input, confidence: 0 };

  // ── Filter intent ──
  const filterPatterns = [
    /filter(?:ed)?\s+by\s+(.+?)(?:\s+(?:sort|show|and|$))/,
    /show(?:ing)?\s+(?:only\s+)?(.+?)(?:\s+(?:sort|with|and|$))/,
    /where\s+(.+?)\s+(?:is|=|equals?)\s+(.+?)(?:\s+(?:sort|show|and|$)|$)/,
  ];
  for (const pat of filterPatterns) {
    const m = text.match(pat);
    if (m) {
      result.filterText = m[2] ?? m[1];
      result.confidence += 0.35;
      break;
    }
  }

  // ── Sort intent ──
  const sortMatch = text.match(/sort(?:ed)?\s+by\s+([\w\s]+?)\s*(descend(?:ing)?|asc(?:ending)?|highest|lowest|desc|asc)?(?:\s|$)/);
  if (sortMatch) {
    const colFragment = sortMatch[1].trim();
    const resolved = resolveCol(colFragment) ?? availableColumns.find(c => c.toLowerCase().includes(colFragment));
    if (resolved) {
      result.sortCol = resolved;
      const dirWord = sortMatch[2] ?? "";
      result.sortDir = /desc|highest|largest/.test(dirWord) ? "desc" : "asc";
      result.confidence += 0.35;
    }
  }

  // ── Calc intent ──
  const calcPatterns: [RegExp, "sum" | "avg" | "min" | "max" | "count"][] = [
    [/\b(?:sum|total)\b/,    "sum"],
    [/\b(?:avg|average|mean)\b/, "avg"],
    [/\bmin(?:imum)?\b/,     "min"],
    [/\bmax(?:imum)?\b/,     "max"],
    [/\bcount\b/,            "count"],
  ];
  const calcOps: Record<string, "sum" | "avg" | "min" | "max" | "count"> = {};
  for (const [pat, op] of calcPatterns) {
    if (pat.test(text)) {
      // Try to find which column the calc applies to
      const colHint = text.match(new RegExp(pat.source + "\\s+(?:of\\s+)?([\\w\\s]+)"))?.[1];
      const col = colHint ? resolveCol(colHint) ?? availableColumns.find(c => c.toLowerCase().includes(colHint.split(" ")[0])) : undefined;
      const target = col ?? availableColumns.find(c => c === "arr" || c === "deal_value" || c === "funding_raised");
      if (target) { calcOps[target] = op; result.confidence += 0.3; }
    }
  }
  if (Object.keys(calcOps).length) result.calcOps = calcOps;

  return result;
}

// ── Activity-based stage auto-transition ────────────────────────────────────

const STAGE_TRIGGERS: { patterns: RegExp[]; stage: string }[] = [
  { patterns: [/contract.*sign/i, /signed.*agreement/i, /closed.*deal/i, /won/i], stage: "Closed Won" },
  { patterns: [/lost.*deal/i, /deal.*lost/i, /rejected/i, /no.*go/i, /churned/i], stage: "Closed Lost" },
  { patterns: [/negotiat/i, /counter.*offer/i, /pricing.*discuss/i], stage: "Negotiation" },
  { patterns: [/proposal.*sent/i, /sent.*proposal/i, /deck.*shared/i], stage: "Proposal" },
  { patterns: [/qualified/i, /discovery.*call/i, /confirmed.*fit/i], stage: "Qualified" },
  { patterns: [/demo.*scheduled/i, /meeting.*booked/i, /call.*set/i], stage: "In Progress" },
];

export function detectStageFromActivity(activityText: string): string | null {
  for (const { patterns, stage } of STAGE_TRIGGERS) {
    if (patterns.some(p => p.test(activityText))) return stage;
  }
  return null;
}
