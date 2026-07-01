
import { apiFetch, getAuthHeaders } from "./api-client";

export interface EnrichmentResult {
  fields: Record<string, unknown>;
  source: "web" | "ai" | "unavailable";
}

/** Sovereign enrichment via our own SearXNG appliance + Cerebras. Returns empty fields
 *  (never fabricated data) when the backend is unavailable. */
export async function enrichCompany(name: string): Promise<EnrichmentResult> {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const headers = await getAuthHeaders();
  try {
    const res = await apiFetch(`${apiUrl}/api/v1/generate/enrich/company`, {
      method: "POST", headers, body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error("API error");
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error);
    return { fields: data.fields, source: data.source ?? "ai" };
  } catch {
    // No fabrication: if sovereign enrichment is unavailable, return nothing rather than
    // inventing financials. The UI shows "no data found" instead of made-up numbers.
    return { fields: {}, source: "unavailable" };
  }
}

export async function enrichPerson(email: string): Promise<EnrichmentResult> {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const headers = await getAuthHeaders();
  try {
    const res = await apiFetch(`${apiUrl}/api/v1/generate/enrich/person`, {
      method: "POST", headers, body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error("API error");
    const data = await res.json() as any;
    if (data.error) throw new Error(data.error);
    return { fields: data.fields, source: data.source ?? "ai" };
  } catch {
    // No fabrication — a company name inferred purely from the email domain is the only
    // safe, factual inference; everything else stays empty until real enrichment succeeds.
    const domain = email.split("@")[1]?.split(".")[0] ?? "";
    return {
      fields: domain ? { company: domain.charAt(0).toUpperCase() + domain.slice(1) } : {},
      source: "unavailable",
    };
  }
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
    const colFragment = sortMatch[1]!.trim();
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
      const colHint: string | undefined = text.match(new RegExp((pat as RegExp).source + "\\s+(?:of\\s+)?([\\w\\s]+)"))?.[1];
      const col = colHint ? resolveCol(colHint) ?? availableColumns.find(c => c.toLowerCase().includes(colHint.split(" ")[0] ?? "")) : undefined;
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
