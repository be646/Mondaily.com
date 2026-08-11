/**
 * SALESFORCE IMPORT — parsing and mapping, with no database in sight.
 *
 * Everything here is pure: bytes in, a plan out. That is deliberate. An importer that parses and
 * writes in one pass can only be tested by letting it write, so the dry-run becomes a second code
 * path that drifts from the real one — and the first time you find out is on somebody's live data.
 * Here the dry-run and the commit consume the SAME plan; committing is just choosing to persist it.
 *
 * ON THE FIELD NAMES. The brief specified `amount_presentment` and `currency_presentment`. Those
 * fields do not exist in this product. Measured against production, deals carry `deal_value` (27
 * records), `amount` (5), `currency`, and BOTH `stage` and `deal_stage`. Writing to invented names
 * would produce records that import cleanly and are invisible to every surface that reads money —
 * reports, pipeline, forecast and the deal card all resolve value through `dealValueOf`, which
 * knows nothing about `_presentment`. So the mapping targets the real schema. A field named like
 * the money is not the money; see the schema-truth rule.
 */

import { dealStageOf } from "@mondaily/shared/deal-stage";

// ── the shapes ────────────────────────────────────────────────────────────────

export type SalesforceObject = "Lead" | "Contact" | "Account" | "Opportunity";

/** Where a Salesforce column ends up, and whether we understood it. */
export interface FieldMapping {
  source: string;
  /** null = we recognised nothing; the admin can still bind it by hand before committing. */
  target: string | null;
  /** How the value is transformed on the way in. */
  kind: "text" | "money" | "currency" | "date" | "stage" | "email" | "phone" | "url" | "number" | "unmapped";
  /** Set when the mapping is a guess rather than a known Salesforce standard field. */
  inferred?: boolean;
}

export interface ParseResult {
  format: "csv" | "json" | "xml";
  object: SalesforceObject;
  /** Mondaily object_type the rows will become. */
  targetType: string;
  rowCount: number;
  columns: string[];
  mappings: FieldMapping[];
  /** Columns we could not place. Surfaced, never silently dropped. */
  unmapped: string[];
  sample: Record<string, unknown>[];
}

export interface MigrationIssue {
  row: number;
  field: string;
  severity: "warn" | "error";
  message: string;
}

export interface MigrationPlan {
  object: SalesforceObject;
  targetType: string;
  scanned: number;
  /** Rows that would be written. */
  ready: number;
  /** Rows held back because something is wrong enough to refuse. */
  rejected: number;
  issues: MigrationIssue[];
  /** The actual node payloads, dry-run and commit alike. */
  records: { data: Record<string, unknown> }[];
  currencies: string[];
}

// ── format detection + parsing ────────────────────────────────────────────────

export function detectFormat(raw: string): "csv" | "json" | "xml" {
  const t = raw.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("<")) return "xml";
  return "csv";
}

/**
 * RFC 4180 CSV, because Salesforce exports are full of quoted commas and embedded newlines —
 * "Acme, Inc." and multi-line description fields are the norm, not the exception. Splitting on
 * commas would shift every subsequent column on exactly the rows a customer cares most about.
 */
export function parseCsv(raw: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"') {
        if (raw[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  if (!header) return [];
  return rows
    .filter(r => r.some(v => v.trim() !== ""))     // trailing blank lines
    .map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/**
 * Salesforce XML exports nest records under a repeating element. Deliberately a shallow reader:
 * no external entities, no DTD, no schema resolution — an XML parser that fetches is an SSRF and
 * an XXE waiting to happen, and a flat export needs none of it.
 */
export function parseXml(raw: string): Record<string, string>[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) {
    throw new Error("This XML declares a DTD or entities, which we don't process. Re-export as CSV or JSON.");
  }
  // CDATA is lifted out BEFORE any tag matching, and comments with it. Measured against a Salesforce
  // export, `<Description><![CDATA[quarterly </Description> review]]></Description>` parsed as
  // `"<![CDATA[quarterly"` — the field regex stopped at the closing tag *inside* the CDATA, which is
  // exactly what CDATA exists to prevent. Description and Notes routinely carry markup, so this
  // silently truncated real text and left literal `<![CDATA[` in the imported record.
  // The placeholder is wrapped in NUL — not legal in XML text, so it cannot collide with real
  // content. A plainer marker like " 3 " would be indistinguishable from the sentence "we sold 3
  // units" and would splice unrelated CDATA into it. Written as an escape rather than a literal
  // NUL byte, which would make the file binary to grep and to most editors.
  const cdata: string[] = [];
  const prepared = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, body: string) => `\u0000${cdata.push(body) - 1}\u0000`);

  const out: Record<string, string>[] = [];
  // Records are the repeated element that itself contains leaf elements.
  const recordRe = /<(records?|sObject|row|Opportunity|Lead|Contact|Account)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of prepared.matchAll(recordRe)) {
    const body = m[2] ?? "";
    const rec: Record<string, string> = {};
    for (const f of body.matchAll(/<([A-Za-z_][\w.:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const key = (f[1] ?? "").split(":").pop() ?? "";
      const value = f[2] ?? "";
      if (!key) continue;
      // A value still holding a tag is a nested sub-object, not a leaf — Salesforce nests the
      // related Owner/Account this way. Storing it produced fields whose value was literally
      // `<Name>Jane</Name>`: markup imported as data, which no downstream surface can read. Left
      // out entirely, so the record is honestly missing a field rather than carrying nonsense.
      // Checked BEFORE restoring CDATA, so text that merely contains "<" is not mistaken for markup.
      if (/<[A-Za-z_/]/.test(value)) continue;
      rec[key] = decodeXmlText(value, cdata);
    }
    if (Object.keys(rec).length) out.push(rec);
  }
  return out;
}

function decodeXmlText(s: string, cdata: string[] = []): string {
  // CDATA is literal by definition: its content is restored AFTER entity decoding, so a `&amp;`
  // written inside a CDATA block stays the five characters the author wrote.
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\u0000(\d+)\u0000/g, (_m, i: string) => cdata[Number(i)] ?? "")
    .trim();
}

export function parseJson(raw: string): Record<string, unknown>[] {
  const j = JSON.parse(raw) as unknown;
  // Salesforce REST wraps rows in { records: [...] }; a plain export is a bare array.
  const rows = Array.isArray(j) ? j : (j as { records?: unknown[] })?.records;
  if (!Array.isArray(rows)) throw new Error("Expected an array of records, or an object with a `records` array.");
  return rows.filter(r => r && typeof r === "object") as Record<string, unknown>[];
}

export function parseAny(raw: string): { format: "csv" | "json" | "xml"; rows: Record<string, unknown>[] } {
  const format = detectFormat(raw);
  const rows = format === "json" ? parseJson(raw) : format === "xml" ? parseXml(raw) : parseCsv(raw);
  return { format, rows };
}

// ── object detection ──────────────────────────────────────────────────────────

/** Salesforce columns that identify which object an export came from. */
const OBJECT_SIGNALS: Record<SalesforceObject, string[]> = {
  Opportunity: ["StageName", "CloseDate", "IsWon", "ForecastCategory", "Probability"],
  Lead:        ["LeadSource", "Status", "IsConverted", "ConvertedAccountId", "Company"],
  Contact:     ["AccountId", "MailingCity", "Title", "ReportsToId"],
  Account:     ["BillingCity", "Industry", "NumberOfEmployees", "AnnualRevenue", "Website"],
};

/** Mondaily object_type for each. Plural, matching what production actually stores ("deals"). */
export const TARGET_TYPE: Record<SalesforceObject, string> = {
  Opportunity: "deals",
  Lead: "person",
  Contact: "person",
  Account: "company",
};

export function detectObject(columns: string[], hint?: string): SalesforceObject {
  const h = (hint ?? "").toLowerCase();
  for (const k of Object.keys(OBJECT_SIGNALS) as SalesforceObject[]) {
    if (h === k.toLowerCase()) return k;
  }
  const set = new Set(columns.map(c => c.toLowerCase()));
  let best: SalesforceObject = "Lead";
  let bestScore = -1;
  for (const [obj, signals] of Object.entries(OBJECT_SIGNALS) as [SalesforceObject, string[]][]) {
    const score = signals.filter(s => set.has(s.toLowerCase())).length;
    if (score > bestScore) { best = obj; bestScore = score; }
  }
  return best;
}

// ── field mapping ─────────────────────────────────────────────────────────────

/**
 * Standard Salesforce → Mondaily. The money and date entries are the ones that matter:
 * `Amount` must land on `deal_value` (what dealValueOf reads) and `CloseDate` on the close stamps,
 * never on updated_at.
 */
const STANDARD: Record<string, { target: string; kind: FieldMapping["kind"] }> = {
  // identity
  name: { target: "name", kind: "text" },
  company: { target: "company", kind: "text" },
  accountname: { target: "name", kind: "text" },
  firstname: { target: "first_name", kind: "text" },
  lastname: { target: "last_name", kind: "text" },
  title: { target: "title", kind: "text" },
  email: { target: "email", kind: "email" },
  phone: { target: "phone", kind: "phone" },
  mobilephone: { target: "phone", kind: "phone" },
  website: { target: "website", kind: "url" },
  industry: { target: "industry", kind: "text" },
  description: { target: "description", kind: "text" },
  leadsource: { target: "source", kind: "text" },
  ownerid: { target: "owner", kind: "text" },
  owner: { target: "owner", kind: "text" },
  // money — the real fields, not the brief's invented ones
  amount: { target: "deal_value", kind: "money" },
  expectedrevenue: { target: "expected_revenue", kind: "money" },
  annualrevenue: { target: "annual_revenue", kind: "money" },
  currencyisocode: { target: "currency", kind: "currency" },
  // pipeline
  stagename: { target: "stage", kind: "stage" },
  probability: { target: "probability", kind: "number" },
  // dates — CloseDate is the whole point of the date handling below
  closedate: { target: "closed_at", kind: "date" },
  createddate: { target: "source_created_at", kind: "date" },
  // geography
  billingcity: { target: "city", kind: "text" },
  billingcountry: { target: "country", kind: "text" },
  mailingcity: { target: "city", kind: "text" },
  mailingcountry: { target: "country", kind: "text" },
  numberofemployees: { target: "employees", kind: "number" },
};

/** Columns that are Salesforce plumbing and carry nothing we want. Dropped LOUDLY, via `unmapped`. */
const IGNORED = /^(id|isdeleted|systemmodstamp|lastmodified(by)?id|createdbyid|lastactivitydate|lastvieweddate|lastreferenceddate|masterrecordid|photourl|jigsaw|cleanstatus)$/i;

function slug(s: string): string {
  return s.replace(/__c$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

export function buildMappings(columns: string[]): FieldMapping[] {
  return columns.map((source): FieldMapping => {
    const key = source.replace(/\s+/g, "").toLowerCase();
    const std = STANDARD[key];
    if (std) return { source, target: std.target, kind: std.kind };
    if (IGNORED.test(key)) return { source, target: null, kind: "unmapped" };

    /**
     * Custom fields (Salesforce suffixes them __c). Carried across under a slugged name rather than
     * discarded — a customer's "Renewal_Risk__c" is often the column they migrated FOR — but marked
     * `inferred` so the mapping matrix shows it as a guess the admin should confirm.
     */
    if (/__c$/i.test(source)) {
      const s = slug(source);
      const kind: FieldMapping["kind"] =
        /amount|revenue|value|price|cost/i.test(s) ? "money"
        : /date|_at$/i.test(s) ? "date"
        : /count|number|qty|quantity/i.test(s) ? "number"
        : "text";
      return { source, target: s, kind, inferred: true };
    }
    return { source, target: null, kind: "unmapped" };
  });
}

// ── value coercion ────────────────────────────────────────────────────────────

/** Salesforce money arrives as "1,234.56", "$1,234.56", "(500)" for negatives, or already numeric. */
export function toMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s);
  s = s.replace(/[()]/g, "").replace(/[^0-9.,-]/g, "");
  // A value with no digit at all ("n/a", "TBD", "unknown") strips to "" — and Number("") is 0,
  // not NaN. Without this guard every unreadable amount imports as a deal worth zero, which is a
  // real number a deal can have, so the damage is invisible: a pipeline of genuine deals silently
  // valued at nothing rather than an import that says it could not read them.
  if (!/[0-9]/.test(s)) return null;
  // "1.234,56" (European) vs "1,234.56" (US): the LAST separator is the decimal one.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Dates → ISO, or null. NEVER a fallback to "now".
 *
 * This is the single most important coercion here. A close date that silently becomes today turns
 * a deal won in 2023 into revenue booked this month — it would move the period figures, the
 * forecast, and every won/lost ratio, and it would look entirely plausible. An unparseable date is
 * reported as an issue and the field is left empty.
 */
export function toIsoDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // Salesforce date-only fields are YYYY-MM-DD; anchor at midday UTC so a timezone shift cannot
  // roll them into the previous or next day (and therefore the previous or next quarter).
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(s);
  const t = dateOnly ? Date.parse(`${s}T12:00:00Z`) : Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export const isWonStage = (stage: string) => /won|closed[\s_-]*won/i.test(stage) && !/lost/i.test(stage);
export const isLostStage = (stage: string) => /lost/i.test(stage);

// ── the plan ──────────────────────────────────────────────────────────────────

/**
 * Turn parsed rows into the exact node payloads that would be written.
 *
 * `overrides` lets an admin re-bind a column in the mapping matrix before committing; it wins over
 * the detected mapping, including binding something we called unmapped.
 */
export function buildPlan(
  object: SalesforceObject,
  rows: Record<string, unknown>[],
  mappings: FieldMapping[],
  overrides: Record<string, string | null> = {},
): MigrationPlan {
  const effective = mappings.map(m =>
    Object.prototype.hasOwnProperty.call(overrides, m.source)
      ? { ...m, target: overrides[m.source], kind: overrides[m.source] ? m.kind === "unmapped" ? "text" as const : m.kind : "unmapped" as const }
      : m);

  const issues: MigrationIssue[] = [];
  const records: { data: Record<string, unknown> }[] = [];
  const currencies = new Set<string>();
  let rejected = 0;

  rows.forEach((row, i) => {
    const data: Record<string, unknown> = {};
    let fatal = false;

    for (const m of effective) {
      if (!m.target) continue;
      const raw = row[m.source];
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;

      switch (m.kind) {
        case "money": {
          const n = toMoney(raw);
          if (n === null) { issues.push({ row: i + 1, field: m.source, severity: "warn", message: `Could not read "${String(raw).slice(0, 40)}" as an amount — left empty.` }); break; }
          data[m.target] = n;
          break;
        }
        case "currency": {
          const c = String(raw).trim().toUpperCase();
          if (!/^[A-Z]{3}$/.test(c)) { issues.push({ row: i + 1, field: m.source, severity: "warn", message: `"${c}" is not a 3-letter currency code — left empty.` }); break; }
          data[m.target] = c;
          currencies.add(c);
          break;
        }
        case "date": {
          const iso = toIsoDate(raw);
          // NOT a fallback to now(). See toIsoDate.
          if (!iso) { issues.push({ row: i + 1, field: m.source, severity: "warn", message: `Could not read "${String(raw).slice(0, 40)}" as a date — left empty rather than defaulted.` }); break; }
          data[m.target] = iso;
          break;
        }
        case "number": {
          const n = Number(String(raw).replace(/[^0-9.-]/g, ""));
          if (Number.isFinite(n)) data[m.target] = n;
          break;
        }
        case "stage": {
          const stage = String(raw).trim();
          // BOTH keys, always. Production had 28 of 44 deals whose two stage fields disagreed;
          // an importer that writes one of them is how that happens again.
          data.stage = stage;
          data.deal_stage = stage;
          break;
        }
        default:
          data[m.target] = String(raw).trim();
      }
    }

    // A record with no name is unusable in every list, board and search in the product.
    if (!data.name) {
      const composed = [row.FirstName, row.LastName].filter(Boolean).join(" ").trim()
        || String(row.Company ?? row.Name ?? "").trim();
      if (composed) data.name = composed;
      else { issues.push({ row: i + 1, field: "Name", severity: "error", message: "No name, company, or first/last name — row skipped." }); fatal = true; }
    }

    /**
     * CLOSE STAMPS FROM THE EXPORT, not from the clock.
     *
     * withStageStamps() only fills won_at/lost_at when they are absent, so setting them here from
     * CloseDate is what stops an import of historical deals from stamping every one of them with
     * today's date — which would book years of past revenue into the current period.
     */
    if (object === "Opportunity") {
      const stage = dealStageOf(data);
      const closed = data.closed_at as string | undefined;
      if (closed && isWonStage(stage)) data.won_at = closed;
      if (closed && isLostStage(stage)) data.lost_at = closed;
      if (!closed && (isWonStage(stage) || isLostStage(stage))) {
        issues.push({ row: i + 1, field: "CloseDate", severity: "warn", message: `Stage "${stage}" is closed but there is no CloseDate — imported without a close date rather than dated today.` });
      }
    }

    if (fatal) { rejected++; return; }
    data.source_system = "salesforce";
    records.push({ data });
  });

  return {
    object,
    targetType: TARGET_TYPE[object],
    scanned: rows.length,
    ready: records.length,
    rejected,
    issues,
    records,
    currencies: [...currencies].sort(),
  };
}

/** One call: bytes → everything the UI needs to show before anyone commits. */
export function parseSalesforceExport(raw: string, hint?: string): ParseResult {
  const { format, rows } = parseAny(raw);
  const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const object = detectObject(columns, hint);
  const mappings = buildMappings(columns);
  return {
    format,
    object,
    targetType: TARGET_TYPE[object],
    rowCount: rows.length,
    columns,
    mappings,
    unmapped: mappings.filter(m => !m.target).map(m => m.source),
    sample: rows.slice(0, 5),
  };
}
