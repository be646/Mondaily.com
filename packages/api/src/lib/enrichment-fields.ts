/**
 * Enrichment field vocabulary — the single definition of which keys may reach `nodes.data`, and how
 * the model's structured groups flatten onto a record.
 *
 * Lives in lib/ rather than jobs/ because TWO callers need it: the enrichment job that writes these
 * fields, and routes/clean.ts, which repairs records written before the allowlist existed. Importing
 * the job from a route would drag an Inngest function definition in with it.
 */
/**
 * Flatten the structured enrichment groups into the flat top-level keys the
 * records sheet / pipeline columns read (job_title, company, email, …), while
 * keeping the grouped objects + arrays for richer detail surfaces.
 */
/**
 * A key is only allowed onto a record if it is one WE named. The model sometimes returns an object
 * keyed by a property's `description` rather than its name, and the old "preserve any already-flat
 * keys" pass wrote those straight through — so 28 person records grew columns literally called
 * "Verified role/profile facts from the web" and "Contact details that LITERALLY appear in the web
 * context…". Same failure shape as the rest of this session: the code was right about what the
 * provider returned and wrong about what it MEANT.
 *
 * This is the schema's own property names, flattened the way flattenEnrichment flattens them, plus
 * the two renamed structures. Nothing else reaches nodes.data.
 */
export const ALLOWED_ENRICHMENT_KEYS = new Set([
  // professional_background
  "job_title", "seniority", "company", "location", "linkedin", "twitter", "summary",
  // company_firmographic_data
  "industry", "employee_range", "arr", "funding_raised", "founded_year", "country", "website", "description",
  // verified_contact
  "email", "phone", "source",
  // renamed structures
  "intent_signals", "churn_risk",
]);

export function flattenEnrichment(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dropped: string[] = [];
  const lift = (group: unknown) => {
    if (group && typeof group === "object" && !Array.isArray(group)) {
      for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
        if (!ALLOWED_ENRICHMENT_KEYS.has(k)) { dropped.push(k); continue; }
        if (v != null && v !== "" && out[k] == null) out[k] = v;
      }
    }
  };
  lift(fields.professional_background);
  lift(fields.company_firmographic_data);
  lift(fields.verified_contact); // email, phone, source → top level
  // Keep the rich structures available too (detail views / future surfaces).
  if (fields.verified_intent_signals) out.intent_signals = fields.verified_intent_signals;
  if (fields.calculated_churn_risk) out.churn_risk = fields.calculated_churn_risk;
  // Preserve already-flat keys the model returned directly — but only ones we named. An unknown key
  // here is not a bonus field, it is the model having misread the schema.
  for (const [k, v] of Object.entries(fields)) {
    if (["professional_background", "company_firmographic_data", "verified_contact", "verified_intent_signals", "calculated_churn_risk"].includes(k)) continue;
    if (!ALLOWED_ENRICHMENT_KEYS.has(k)) { dropped.push(k); continue; }
    if (v != null && v !== "" && out[k] == null) out[k] = v;
  }
  // Say so rather than swallowing it. A silent drop here would hide a degraded provider response.
  if (dropped.length) {
    console.warn(`[enrich-record] dropped ${dropped.length} off-schema key(s) from the model response:`,
      dropped.map(k => k.slice(0, 60)));
  }
  return out;
}

/**
 * Merge agent output into a record WITHOUT overwriting what a person put there.
 *
 * Both enrichment writers spread the agent's fields last — `{ ...node.data, ...fields }` — so an
 * autonomous run silently replaced human input: set a deal's country by hand, let enrichment run,
 * and the agent's guess won. The notification they send says "AI filled in", which is what they
 * should have been doing all along. A record belongs to the user; an agent may COMPLETE it, not
 * correct it.
 *
 * Extracted because there are two writers and fixing one is not fixing the rule — the same mistake
 * this codebase has now made with close-date stamping, win-dating and stage resolution.
 *
 * Blank means absent, null, or empty/whitespace. Returns what was applied and what was kept, so the
 * caller can tell the user honestly instead of claiming to have filled a field it left alone.
 */
export function fillBlanks(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): { merged: Record<string, unknown>; applied: string[]; kept: string[] } {
  const base = existing ?? {};
  const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
  const applied: string[] = [], kept: string[] = [];
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(incoming)) {
    if (isBlank(v)) continue;
    if (isBlank(base[k])) { out[k] = v; applied.push(k); }
    else kept.push(k);
  }
  return { merged: out, applied, kept };
}

