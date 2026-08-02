import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { isEmbeddingsEnabled } from "../lib/embeddings";
import { requireAdminRole } from "../middleware/rbac";
import { flattenEnrichment, ALLOWED_ENRICHMENT_KEYS } from "../lib/enrichment-fields";

/**
 * DATA CLEANING — overlap analysis, and the two repairs it justified.
 *
 * The scans (/types, /overlap, /duplicates) are PURE READS. Two endpoints mutate, both admin-only
 * and both dry-run by default:
 *
 *   /merge-types    — changes `object_type` and nothing else. No field combined, no value chosen
 *                     between, no row removed. Reversible by running it back the other way.
 *   /dedupe-records — DELETES redundant rows. Irreversible. Guarded accordingly: identity requires
 *                     source_url AND name, groups with attachments are refused rather than merged,
 *                     and the full payload of every deleted row lands in the audit trail before
 *                     anything is removed.
 *
 * Each earned its scope empirically rather than by assumption, and the order matters. The first
 * scan showed person(588)/people(138) share 2 records and company/companies, tasks/task,
 * expenses/expense and contacts/contact-leads share NONE — duplicate type NAMES, not duplicate
 * records, so /merge-types was enough and no record-merge engine was built. Only the later
 * within-type scan found the actual damage: 588 `person` rows for 137 entities, from a Discovery
 * monitor re-creating the same leads every 4 hours (fixed in routes/decisions.ts). That is what
 * /dedupe-records exists for.
 *
 * The restraint is deliberate. This session's recurring failure was tools that were correct about
 * the rows they fetched and wrong about what those rows REPRESENTED — including, at one point, this
 * file's own "strong key" classification, which treated a shared source_url as a shared identity
 * until the data showed one law firm's website hosting both the firm and a lawyer at it.
 *
 * The existing DedupPanel compares records WITHIN one object type by exact match after
 * normalisation. It cannot see near-duplicate TYPES — `person` vs `people`, `contacts` vs
 * `contact-leads` — which is where the real ambiguity lives.
 */
const router = new Hono<{ Variables: { userId: string; workspaceId: string; role: string } }>();
router.use("*", requireAuth);

/** Normalised comparison of type names, so singular/plural and separator variants collide. */
function stem(x: string): string {
  const n = x.toLowerCase().replace(/[-_\s]/g, "");
  for (const [from, to] of [["people", "person"], ["ies", "y"], ["ses", "s"], ["s", ""]] as const) {
    if (n.endsWith(from)) return n.slice(0, n.length - from.length) + to;
  }
  return n;
}

/** True when two type names are similar enough that a human could plausibly conflate them. */
function confusable(a: string, b: string): boolean {
  if (a === b) return false;
  const na = a.toLowerCase().replace(/[-_\s]/g, "");
  const nb = b.toLowerCase().replace(/[-_\s]/g, "");
  return na.includes(nb) || nb.includes(na) || stem(a) === stem(b);
}

/**
 * GET /clean/types — every object type with its REAL count, plus the pairs worth investigating.
 * Cheap: one grouped count, no embeddings, no per-record work.
 */
router.get("/types", async (c) => {
  const ws = c.get("workspaceId");
  // Optional vertical scope. An object_type alone does NOT identify one population: `expense`
  // exists both as a Finance document (vertical=finance: amount_cents/category/status) and as rows
  // of a user-built "expenses" records sheet (vertical=shared: gross_amount/main_category/name).
  // Counting the type across both made the Finance tab read "Expenses 11" over a list of 1 — the
  // ten it counted are a different shape entirely and that list can never show them.
  const vertical = c.req.query("vertical");
  const SAFE_VERTICAL = /^[a-z_]{1,32}$/;
  if (vertical && SAFE_VERTICAL.test(vertical)) {
    const acc = new Map<string, number>();
    const PAGE = 1000;
    for (let from = 0; from < 100_000; from += PAGE) {
      const { data: page, error: pErr } = await supabase
        .from("nodes").select("object_type").eq("workspace_id", ws).eq("vertical", vertical)
        .order("id", { ascending: true }).range(from, from + PAGE - 1);
      if (pErr) return c.json({ error: pErr.message }, 500);
      const rows = page ?? [];
      for (const r of rows) {
        const t = String((r as { object_type?: string }).object_type ?? "");
        if (t) acc.set(t, (acc.get(t) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
    }
    const scoped = [...acc].map(([object_type, n]) => ({ object_type, n })).sort((a, b) => b.n - a.n);
    return c.json({ types: scoped, vertical, pairs: [] });
  }

  const { data, error } = await supabase.rpc("object_type_counts", { ws });
  let counts: { object_type: string; n: number }[];

  if (error || !data) {
    // Fallback when the RPC isn't present: page the table rather than an unbounded select, which
    // silently truncates past PostgREST's row cap and would UNDERSTATE every count here.
    const acc = new Map<string, number>();
    const PAGE = 1000;
    for (let from = 0; from < 100_000; from += PAGE) {
      const { data: page, error: pErr } = await supabase
        .from("nodes").select("object_type").eq("workspace_id", ws)
        .order("id", { ascending: true }).range(from, from + PAGE - 1);
      if (pErr) return c.json({ error: pErr.message }, 500);
      const rows = page ?? [];
      for (const r of rows) {
        const t = String((r as { object_type?: string }).object_type ?? "");
        if (t) acc.set(t, (acc.get(t) ?? 0) + 1);
      }
      if (rows.length < PAGE) break;
    }
    counts = [...acc].map(([object_type, n]) => ({ object_type, n }));
  } else {
    counts = (data as { object_type: string; n: number }[]) ?? [];
  }

  counts.sort((a, b) => b.n - a.n);
  const pairs: { a: string; b: string; a_count: number; b_count: number; why: string }[] = [];
  for (let i = 0; i < counts.length; i++) {
    for (let j = i + 1; j < counts.length; j++) {
      const A = counts[i]!, B = counts[j]!;
      if (!confusable(A.object_type, B.object_type)) continue;
      pairs.push({
        a: A.object_type, b: B.object_type, a_count: A.n, b_count: B.n,
        why: stem(A.object_type) === stem(B.object_type)
          ? "same word, singular/plural" : "one name contains the other",
      });
    }
  }

  return c.json({
    types: counts,
    confusable_pairs: pairs,
    embeddings_available: isEmbeddingsEnabled(),
    note: "Counts are exact. Pairs are name-similarity only — run an overlap scan to see whether they actually share records.",
  });
});

/**
 * POST /clean/overlap — how much do two types actually overlap?
 *
 * Two independent signals, reported separately because they carry very different confidence:
 *   key      — identical email / phone / normalised name. Strong evidence of the same entity.
 *   semantic — embeddings within `min_similarity`. Suggestive; needs a human eye.
 */
router.post("/overlap", zValidator("json", z.object({
  type_a: z.string().min(1),
  type_b: z.string().min(1),
  min_similarity: z.number().min(0.5).max(1).optional(),
  max_pairs: z.number().int().min(1).max(500).optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const { type_a, type_b, min_similarity = 0.92, max_pairs = 200 } = c.req.valid("json");

  const { data: keyRows, error: keyErr } = await supabase.rpc("cross_type_key_overlap", {
    ws, type_a, type_b, max_pairs,
  });
  if (keyErr) return c.json({ error: `Key overlap scan failed: ${keyErr.message}`, hint: "Has the cross-type-duplicates migration been applied?" }, 500);

  const keyPairs = (keyRows ?? []) as { a_id: string; b_id: string; match_key: string; match_value: string }[];

  // Semantic pass is OPTIONAL — it needs both the embed appliance and an indexed workspace. When
  // either is missing we say so rather than silently returning fewer results and letting the number
  // read as "these types barely overlap".
  let semanticPairs: { a_id: string; b_id: string; similarity: number }[] = [];
  let semanticStatus = "skipped: embeddings not configured";
  if (isEmbeddingsEnabled()) {
    const { data: semRows, error: semErr } = await supabase.rpc("cross_type_semantic_overlap", {
      ws, type_a, type_b, min_similarity, max_pairs,
    });
    if (semErr) semanticStatus = `unavailable: ${semErr.message}`;
    else {
      semanticPairs = (semRows ?? []) as { a_id: string; b_id: string; similarity: number }[];
      semanticStatus = semanticPairs.length ? "ok" : "ok: no pairs above the threshold";
    }
  }

  // Hydrate names for the evidence table, in ONE query rather than per pair.
  const ids = [...new Set([
    ...keyPairs.flatMap(p => [p.a_id, p.b_id]),
    ...semanticPairs.flatMap(p => [p.a_id, p.b_id]),
  ])];
  const nameById = new Map<string, string>();
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 200) {
      // ws-scoped even though the ids come from a workspace-scoped RPC — an unscoped read by id is
      // exactly the shape the isolation scan exists to keep out of the codebase.
      const { data: rows } = await supabase.from("nodes").select("id, data").eq("workspace_id", ws).in("id", ids.slice(i, i + 200));
      for (const r of rows ?? []) {
        const d = (r as { data?: Record<string, unknown> }).data ?? {};
        nameById.set(String((r as { id: string }).id), String(d.name ?? d.Name ?? d.full_name ?? d.company_name ?? "Untitled"));
      }
    }
  }
  const label = (id: string) => nameById.get(id) ?? id.slice(0, 8);

  // A record can match on several keys; count DISTINCT records, not pairs, or the headline
  // overstates the overlap.
  const distinctA = new Set([...keyPairs.map(p => p.a_id), ...semanticPairs.map(p => p.a_id)]);
  const distinctB = new Set([...keyPairs.map(p => p.b_id), ...semanticPairs.map(p => p.b_id)]);

  return c.json({
    type_a, type_b,
    key_matches: keyPairs.map(p => ({
      a_id: p.a_id, b_id: p.b_id, a_name: label(p.a_id), b_name: label(p.b_id),
      matched_on: p.match_key, value: p.match_value,
    })),
    semantic_matches: semanticPairs.map(p => ({
      a_id: p.a_id, b_id: p.b_id, a_name: label(p.a_id), b_name: label(p.b_id),
      similarity: Number(p.similarity.toFixed(3)),
    })),
    summary: {
      records_in_a_with_a_match: distinctA.size,
      records_in_b_with_a_match: distinctB.size,
      key_pairs: keyPairs.length,
      semantic_pairs: semanticPairs.length,
      // Both scans are capped; at the cap the real overlap is larger and the caller must not read
      // these as totals.
      truncated: keyPairs.length >= max_pairs || semanticPairs.length >= max_pairs,
    },
    semantic_status: semanticStatus,
    read_only: true,
  });
});

/**
 * POST /clean/duplicates — duplicate groups WITHIN one object type.
 *
 * The cross-type scan asked "do these two types overlap?" and mostly answered no. The real damage
 * was inside a single type: 588 `person` records for 136 distinct entities, created by a Discovery
 * monitor that re-ran every 4 hours with no existence check (fixed in routes/decisions.ts).
 *
 * Read-only. Groups are ordered by confidence — source_url and email identify an entity; name does
 * NOT, and is reported separately so it is never actioned as if it did.
 */
router.post("/duplicates", zValidator("json", z.object({
  object_type: z.string().min(1),
  max_groups: z.number().int().min(1).max(500).optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const { object_type, max_groups = 200 } = c.req.valid("json");

  const { data, error } = await supabase.rpc("within_type_duplicate_groups", {
    ws, target_type: object_type, max_groups,
  });
  if (error) return c.json({ error: `Duplicate scan failed: ${error.message}`, hint: "Has the cross-type-duplicates migration been applied?" }, 500);

  const groups = (data ?? []) as { match_key: string; match_value: string; copies: number; node_ids: string[] }[];
  const { count: total } = await supabase.from("nodes").select("id", { count: "exact", head: true })
    .eq("workspace_id", ws).eq("object_type", object_type);

  // A record can appear in several groups (same email AND same name). Count DISTINCT redundant
  // records, or the headline double-counts and overstates how much there is to clean.
  const strong = groups.filter(g => g.match_key === "source_url" || g.match_key === "email");
  const weak   = groups.filter(g => g.match_key === "name" || g.match_key === "phone");
  const redundant = new Set<string>();
  for (const g of strong) g.node_ids.slice(1).forEach(id => redundant.add(id));

  return c.json({
    object_type,
    total_records: total ?? 0,
    strong_groups: strong.map(g => ({ matched_on: g.match_key, value: g.match_value, copies: Number(g.copies), node_ids: g.node_ids })),
    weak_groups:   weak.map(g   => ({ matched_on: g.match_key, value: g.match_value, copies: Number(g.copies), node_ids: g.node_ids })),
    summary: {
      redundant_records_by_strong_key: redundant.size,
      would_remain: (total ?? 0) - redundant.size,
      strong_group_count: strong.length,
      weak_group_count: weak.length,
      truncated: groups.length >= max_groups,
    },
    guidance: "strong_groups (source_url/email) identify the same entity. weak_groups (name/phone) are candidates only — two businesses can share a name, so these need a human before any action.",
    read_only: true,
  });
});

/**
 * POST /clean/merge-types — move every record of `from` onto `to`.
 *
 * This is the ONLY mutating endpoint here, and it exists because the overlap scan showed the real
 * problem is not duplicate RECORDS but duplicate TYPE NAMES: person(588)/people(138) share 2
 * records, company/companies and tasks/task share none. There is nothing to merge at the record
 * level — the records just live under two names for one concept.
 *
 * So this changes `object_type` and touches NO record content. Nothing is deleted, no fields are
 * combined, no values are chosen between. That is what makes it reversible: running it back the
 * other way restores the previous state exactly.
 *
 * Safety:
 *  - admin only
 *  - dry_run defaults TRUE, so the destructive form must be asked for explicitly
 *  - refuses when the two types share records, because then it IS a record merge and this is the
 *    wrong tool
 *  - writes an activity row naming both types and the count, so the operation is auditable and the
 *    inverse is obvious
 */
router.post("/merge-types", requireAdminRole, zValidator("json", z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  dry_run: z.boolean().optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const { from, to } = c.req.valid("json");
  const dryRun = c.req.valid("json").dry_run !== false;   // explicit false required to mutate
  if (from === to) return c.json({ error: "`from` and `to` are the same type." }, 400);

  const countOf = async (t: string) => {
    const { count } = await supabase.from("nodes").select("id", { count: "exact", head: true })
      .eq("workspace_id", ws).eq("object_type", t);
    return count ?? 0;
  };
  const [fromCount, toCount] = await Promise.all([countOf(from), countOf(to)]);
  if (fromCount === 0) return c.json({ error: `No records have object_type "${from}".` }, 400);

  // If the two types share records, moving them creates real duplicates inside one type. That needs
  // a record-level merge with a human choosing survivors — not this.
  const { data: shared } = await supabase.rpc("cross_type_key_overlap", { ws, type_a: from, type_b: to, max_pairs: 5 });
  const sharedPairs = (shared ?? []) as unknown[];
  if (sharedPairs.length > 0) {
    return c.json({
      error: `"${from}" and "${to}" share records, so moving them would create duplicates inside "${to}".`,
      shared_pairs: sharedPairs.length,
      hint: "Resolve the shared records first — this endpoint only renames a type, it never merges record content.",
    }, 409);
  }

  if (dryRun) {
    return c.json({
      dry_run: true, from, to,
      records_that_would_move: fromCount,
      records_already_in_target: toCount,
      resulting_total: fromCount + toCount,
      reversible: `POST again with from="${to}", to="${from}" — but that would move all ${fromCount + toCount}, not just these.`,
      note: "Only object_type changes. No record content is read, combined, or deleted.",
      confirm_with: { from, to, dry_run: false },
    });
  }

  // Paged update: a single unbounded update is capped like every other unbounded statement here,
  // which would move SOME records and report success — the worst outcome for a schema change.
  let moved = 0;
  for (let guard = 0; guard < 200; guard++) {
    const { data: batch, error: selErr } = await supabase.from("nodes").select("id")
      .eq("workspace_id", ws).eq("object_type", from).limit(500);
    if (selErr) return c.json({ error: selErr.message, moved }, 500);
    const ids = (batch ?? []).map(r => (r as { id: string }).id);
    if (!ids.length) break;
    const { error: updErr } = await supabase.from("nodes").update({ object_type: to }).in("id", ids);
    if (errOf(updErr)) return c.json({ error: errOf(updErr), moved, partial: true }, 500);
    moved += ids.length;
  }

  // `activities.node_id` is NOT NULL, and this insert used to omit it AND swallow the error with
  // `.then(() => {}, () => {})` — so the audit silently never landed and the response still claimed
  // success. A rename is not node-specific, so it is anchored to one moved record purely to satisfy
  // the constraint, and whether the audit actually wrote is now REPORTED rather than assumed.
  const { data: anchor } = await supabase.from("nodes").select("id")
    .eq("workspace_id", ws).eq("object_type", to).limit(1).maybeSingle();
  const { error: auditErr } = await supabase.from("activities").insert({
    node_id: (anchor as { id: string } | null)?.id ?? null,
    workspace_id: ws, actor_type: "human", actor_id: c.get("userId"), action: "updated",
    diff: { data_cleaning: "merge_types", from, to, records_moved: moved },
  });

  return c.json({ ok: true, from, to, records_moved: moved, now_in_target: moved + toCount,
    audit_written: !auditErr,
    ...(auditErr ? { audit_error: auditErr.message } : {}),
    reverse_with: { from: to, to: from, dry_run: false },
    caveat: `Reversing moves ALL ${moved + toCount} records in "${to}", including the ${toCount} that were already there.` });
});

function errOf(e: unknown): string | null {
  return e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : null;
}

// ── Repairing records written before the enrichment allowlist existed ──────────────────────────

/**
 * The enrichment schema's `description` strings. When the model keyed its response by description
 * instead of property name, these landed on records AS FIELD NAMES — so a record grew a column
 * called "Verified role/profile facts from the web". Fixed forward in lib/enrichment-fields.ts;
 * these are the strings needed to recognise the damage already written.
 */
const SCHEMA_DESCRIPTIONS = [
  "Verified role/profile facts from the web",
  "Contact details that LITERALLY appear in the web context, each with its source. Omit any you cannot find verbatim — never guess an email/phone pattern.",
  "Source-backed signals (role change, hiring, funding, expansion). Empty if none found.",
  "Source-backed signals (funding, hiring, expansion, layoffs). Empty if none found.",
  "Estimated, derived only from the signals above",
  "Verified firmographics from the web",
  "e.g. IC / manager / director / VP / C-level",
  "1-2 sentence professional bio",
  "URL where the email/phone was found",
  "low | medium | high",
];

/**
 * Is this key one of ours-gone-wrong, rather than something a person created?
 *
 * MATTERS A LOT. Column names in this product are free text (see the Add-column input in
 * record-table.tsx), so a user can legitimately create "Job Title" or "Deal Notes". A rule like
 * "delete any key containing a space" would therefore delete real user data. So the test is
 * membership of the known description list, or a prefix of one — the observed damage included
 * truncations like "Source-backed signals" and "Contact details that LITERALLY appear in the web
 * context". A prefix must be at least 20 characters to count, so no short human label can match.
 */
export function isSchemaDescriptionKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  return SCHEMA_DESCRIPTIONS.some(d => d === k || (k.length >= 20 && d.startsWith(k)));
}

/**
 * POST /clean/repair-keys — remove schema-description field names, PRESERVING what they contain.
 *
 * A blanket delete was the obvious move and it was wrong: of 44 such keys in this workspace, 40 held
 * `{}` / `[]` but 4 held real enrichment — one carried `{"company":"Notion","summary":"…"}`. Deleting
 * those would have destroyed data while claiming to clean it.
 *
 * So each value is run through the SAME flattener the enrichment job uses, lifting any recognised
 * field to its proper name, and an existing real value is never overwritten. Only then is the prose
 * key removed. Admin-only, dry-run by default, and every change is reported per record.
 */
router.post("/repair-keys", requireAdminRole, zValidator("json", z.object({
  object_type: z.string().min(1).optional(),   // omit to sweep every type
  dry_run: z.boolean().optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const { object_type } = c.req.valid("json");
  const dryRun = c.req.valid("json").dry_run !== false;

  const rows: { id: string; object_type: string; data: Record<string, unknown> | null }[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    let q = supabase.from("nodes").select("id, object_type, data").eq("workspace_id", ws);
    if (object_type) q = q.eq("object_type", object_type);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return c.json({ error: error.message }, 500);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const changes: {
    id: string; object_type: string; name: string;
    removed_keys: string[]; lifted: Record<string, unknown>; discarded_empty: string[];
  }[] = [];

  for (const n of rows) {
    const data = n.data ?? {};
    const badKeys = Object.keys(data).filter(isSchemaDescriptionKey);
    if (!badKeys.length) continue;

    const lifted: Record<string, unknown> = {};
    const discardedEmpty: string[] = [];
    for (const k of badKeys) {
      const v = data[k];
      // The value may be a whole enrichment group ({professional_background:{…}}) or already flat
      // ({company:"Notion"}). flattenEnrichment handles both, and drops anything off-schema.
      const salvage = v && typeof v === "object" && !Array.isArray(v)
        ? flattenEnrichment(v as Record<string, unknown>)
        : {};
      const useful = Object.entries(salvage).filter(([sk, sv]) =>
        sv != null && sv !== "" && ALLOWED_ENRICHMENT_KEYS.has(sk) &&
        (data[sk] == null || data[sk] === ""));      // NEVER overwrite a real existing value
      if (useful.length) for (const [sk, sv] of useful) lifted[sk] = sv;
      else discardedEmpty.push(k);
    }
    changes.push({
      id: n.id, object_type: n.object_type,
      name: String(data.name ?? data.Name ?? "Untitled").slice(0, 60),
      removed_keys: badKeys, lifted, discarded_empty: discardedEmpty,
    });
  }

  const summary = {
    records_scanned: rows.length,
    records_affected: changes.length,
    prose_keys_to_remove: changes.reduce((a, ch) => a + ch.removed_keys.length, 0),
    records_where_data_is_recovered: changes.filter(ch => Object.keys(ch.lifted).length > 0).length,
    fields_recovered: changes.reduce((a, ch) => a + Object.keys(ch.lifted).length, 0),
  };

  if (dryRun) {
    return c.json({
      dry_run: true, object_type: object_type ?? "(all types)", summary,
      changes: changes.map(ch => ({ id: ch.id, object_type: ch.object_type, name: ch.name,
        removes: ch.removed_keys.map(k => k.slice(0, 60)), recovers: ch.lifted })),
      safety: "Keys are matched against the known enrichment schema descriptions, never by 'contains a space' — column names are free text, so that rule would delete real user fields.",
      confirm_with: { ...(object_type ? { object_type } : {}), dry_run: false },
    });
  }

  if (!changes.length) return c.json({ ok: true, summary, note: "Nothing to repair." });

  // Audit FIRST, and abort if it cannot be written — same rule as /dedupe-records. Lifting recovers
  // the fields the flattener recognises, but anything off-schema inside a removed key is genuinely
  // discarded, so the audit stores each removed key's ORIGINAL VALUE. Without that this is a lossy
  // edit with no record of what was lost.
  const originalById = new Map(rows.map(r => [r.id, r.data ?? {}]));
  const { error: auditErr } = await supabase.from("activities").insert(changes.map(ch => ({
    node_id: ch.id, workspace_id: ws, actor_type: "human", actor_id: c.get("userId"),
    action: "updated",
    diff: {
      data_cleaning: "repair_keys",
      recovered_fields: ch.lifted,
      removed: Object.fromEntries(ch.removed_keys.map(k => [k, originalById.get(ch.id)![k]])),
    },
  })));
  if (auditErr) return c.json({
    error: `Could not write the audit snapshot: ${auditErr.message}`,
    hint: "Nothing was changed. The snapshot records what each removed key contained, so it must land first.",
  }, 500);

  let updated = 0;
  for (const ch of changes) {
    const next: Record<string, unknown> = { ...originalById.get(ch.id)!, ...ch.lifted };
    for (const k of ch.removed_keys) delete next[k];
    const { error } = await supabase.from("nodes").update({ data: next })
      .eq("workspace_id", ws).eq("id", ch.id);
    if (error) return c.json({ error: error.message, updated, partial: true,
      hint: "The audit snapshot covers every planned record, including any not yet updated." }, 500);
    updated++;
  }

  return c.json({ ok: true, summary: { ...summary, records_updated: updated } });
});

// ── Record-level de-duplication ────────────────────────────────────────────────────────────────

type NodeRow = {
  id: string; data: Record<string, unknown> | null; created_at: string;
  enriched_at: string | null; ai_summary: string | null; created_by: string | null;
};

/** Normalised name, so "Skin&Beauty" and "Skin & Beauty" collide but distinct entities do not. */
export function normName(x: unknown): string {
  return String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The identity key for a discovered record: source_url AND normalised name, together.
 *
 * source_url ALONE is not an identity, and the data proved it. `lawwarsaw.com` carries both
 * "Lemon, Keirn & Rovenstine, LLC" (the firm) and "W. Douglas Lemon" (a lawyer at it) — two real
 * entities behind one website. Keying on the URL alone would have deleted one of them. A URL
 * identifies a SITE; a site can host several entities.
 *
 * Returns null when either half is missing or too short to be meaningful — such a record is left
 * alone rather than guessed at.
 */
export function identityKey(data: Record<string, unknown> | null): string | null {
  const url = String((data ?? {}).source_url ?? "").trim();
  const name = normName((data ?? {}).name ?? (data ?? {}).Name);
  if (!url || name.length < 3) return null;
  return `${url}||${name}`;
}

/** How much is actually on this record? Used to pick the survivor. */
export function richness(n: NodeRow): number {
  const d = n.data ?? {};
  return Object.entries(d).filter(([, v]) => v != null && v !== "" &&
    !(Array.isArray(v) && v.length === 0) &&
    !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0)).length;
}

/**
 * Pick the copy to KEEP. Richest wins, because enrichment landed on later copies — in this
 * workspace the oldest copy was also the richest in only 11 of 71 groups, so "keep the oldest"
 * would have thrown away enrichment on 60 entities. Ties break toward enriched, then toward the
 * oldest id-stable record so the choice is deterministic and re-runnable.
 */
export function pickSurvivor(group: NodeRow[]): NodeRow {
  return group.slice().sort((a, b) =>
    richness(b) - richness(a) ||
    Number(!!b.enriched_at) - Number(!!a.enriched_at) ||
    Number(!!b.ai_summary) - Number(!!a.ai_summary) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id))[0]!;
}

/**
 * POST /clean/dedupe-records — collapse duplicate records within one object type.
 *
 * The only endpoint here that removes rows, and the guards reflect that:
 *
 *  - admin only, and `dry_run` defaults TRUE (a missing field is the safe form)
 *  - identity is source_url + name, never source_url alone (see identityKey)
 *  - a group is REFUSED, not deleted, if any copy has notes, tasks, or graph edges attached.
 *    Attachment means someone or something built on that specific row, and there is no merge
 *    capability to carry it across. Refusing is the honest outcome.
 *  - the full payload of every deleted row is written into the audit activity, so the operation is
 *    recoverable from the audit trail rather than merely logged
 *  - counts DISTINCT ids throughout — a record can appear in more than one grouping
 */
router.post("/dedupe-records", requireAdminRole, zValidator("json", z.object({
  object_type: z.string().min(1),
  dry_run: z.boolean().optional(),
  max_delete: z.number().int().min(1).max(5000).optional(),
})), async (c) => {
  const ws = c.get("workspaceId");
  const { object_type, max_delete = 5000 } = c.req.valid("json");
  const dryRun = c.req.valid("json").dry_run !== false;   // explicit false required to delete

  // Paged read. An unbounded select truncates at PostgREST's row cap and would silently dedupe only
  // the first page while reporting a total — the exact class of bug this tool exists to clean up.
  const rows: NodeRow[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await supabase.from("nodes")
      .select("id, data, created_at, enriched_at, ai_summary, created_by")
      .eq("workspace_id", ws).eq("object_type", object_type)
      .order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) return c.json({ error: error.message }, 500);
    const page = (data ?? []) as NodeRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (rows.length === 0) return c.json({ error: `No records have object_type "${object_type}".` }, 400);

  const groups = new Map<string, NodeRow[]>();
  let unkeyed = 0;
  for (const n of rows) {
    const k = identityKey(n.data);
    if (!k) { unkeyed++; continue; }
    const g = groups.get(k); if (g) g.push(n); else groups.set(k, [n]);
  }
  const dupGroups = [...groups.entries()].filter(([, v]) => v.length > 1);

  // Which candidate rows carry attachments? Batched by id, three surfaces, one pass each.
  const candidates = dupGroups.flatMap(([, g]) => g.map(n => n.id));
  const attached = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const slice = candidates.slice(i, i + 200);
    const [notes, tasks, edgesFrom, edgesTo] = await Promise.all([
      supabase.from("activities").select("node_id").eq("workspace_id", ws)
        .in("action", ["note", "note_edited"]).in("node_id", slice),
      supabase.from("tasks").select("record_id").eq("workspace_id", ws).in("record_id", slice),
      supabase.from("edges").select("from_node_id").eq("workspace_id", ws).in("from_node_id", slice),
      supabase.from("edges").select("to_node_id").eq("workspace_id", ws).in("to_node_id", slice),
    ]);
    // A failed probe must NOT read as "nothing attached" — that would licence a wrong deletion.
    for (const r of [notes, tasks, edgesFrom, edgesTo]) {
      if (r.error) return c.json({
        error: `Attachment check failed: ${r.error.message}`,
        hint: "Refusing to continue — a failed check here cannot be treated as 'no attachments'.",
      }, 500);
    }
    for (const r of notes.data ?? []) attached.add(String((r as { node_id: string }).node_id));
    for (const r of tasks.data ?? []) attached.add(String((r as { record_id: string }).record_id));
    for (const r of edgesFrom.data ?? []) attached.add(String((r as { from_node_id: string }).from_node_id));
    for (const r of edgesTo.data ?? []) attached.add(String((r as { to_node_id: string }).to_node_id));
  }

  const plan: { key: string; name: string; copies: number; keep: string; delete_ids: string[] }[] = [];
  const blocked: { key: string; name: string; copies: number; attached_ids: string[]; why: string }[] = [];
  for (const [key, g] of dupGroups) {
    const name = String((g[0]!.data ?? {}).name ?? "Untitled");
    const survivor = pickSurvivor(g);
    const doomed = g.filter(n => n.id !== survivor.id);
    const withAttachments = doomed.filter(n => attached.has(n.id));
    if (withAttachments.length) {
      blocked.push({ key, name, copies: g.length, attached_ids: withAttachments.map(n => n.id),
        why: "a copy that would be removed has notes, tasks or graph edges attached — no merge capability exists to carry them over" });
      continue;
    }
    plan.push({ key, name, copies: g.length, keep: survivor.id, delete_ids: doomed.map(n => n.id) });
  }

  const deleteIds = [...new Set(plan.flatMap(p => p.delete_ids))];
  const summary = {
    total_records: rows.length,
    unkeyed_records_left_alone: unkeyed,
    duplicate_groups: dupGroups.length,
    groups_to_collapse: plan.length,
    groups_blocked_by_attachments: blocked.length,
    records_to_delete: deleteIds.length,
    would_remain: rows.length - deleteIds.length,
  };

  if (dryRun) {
    return c.json({
      dry_run: true, object_type, summary,
      plan: plan.map(p => ({ name: p.name, copies: p.copies, keep: p.keep, delete: p.delete_ids.length })),
      blocked,
      survivor_rule: "richest payload wins; ties break toward enriched, then the oldest record",
      identity_rule: "source_url + normalised name. Never source_url alone — one website can host two real entities.",
      irreversible: "Executing DELETES rows. The full payload of each deleted row is written to the audit trail, but the rows themselves do not come back.",
      confirm_with: { object_type, dry_run: false },
    });
  }

  if (deleteIds.length > max_delete) {
    return c.json({ error: `Plan would delete ${deleteIds.length} records, above max_delete=${max_delete}.`,
      hint: "Raise max_delete deliberately after reviewing the dry run." }, 400);
  }

  // Snapshot BEFORE deleting, so the audit row is a recovery artifact and not just a count.
  const byId = new Map(rows.map(n => [n.id, n]));
  const snapshot = deleteIds.map(id => {
    const n = byId.get(id)!;
    return { id, created_at: n.created_at, created_by: n.created_by, data: n.data };
  });
  // ONE audit row per collapsed group, anchored to the SURVIVOR via node_id.
  //
  // `activities.node_id` is NOT NULL — a single workspace-wide row omitting it fails outright, which
  // is how the first attempt at this was caught (by its own guard, before deleting anything). But
  // per-survivor is also the better shape: each surviving record's own timeline now carries the
  // copies it absorbed, so the recovery data sits where someone looking at that record would find
  // it, rather than in one anonymous blob.
  const snapById = new Map(snapshot.map(s => [s.id, s]));
  const auditRows = plan.map(p => ({
    node_id: p.keep,
    workspace_id: ws, actor_type: "human", actor_id: c.get("userId"), action: "updated",
    diff: {
      data_cleaning: "dedupe_records", object_type, name: p.name,
      copies_absorbed: p.delete_ids.length, identity_key: p.key,
      deleted_records: p.delete_ids.map(id => snapById.get(id)).filter(Boolean),
    },
  }));
  const { error: auditErr } = await supabase.from("activities").insert(auditRows);
  // If the recovery artifact cannot be written, do not delete. Losing the rows AND the record of
  // what they were is strictly worse than not cleaning.
  if (auditErr) return c.json({ error: `Could not write the audit snapshot: ${auditErr.message}`,
    hint: "Nothing was deleted. The snapshot is the only recovery path, so it must land first." }, 500);

  let deleted = 0;
  for (let i = 0; i < deleteIds.length; i += 200) {
    const slice = deleteIds.slice(i, i + 200);
    const { error } = await supabase.from("nodes").delete().eq("workspace_id", ws).in("id", slice);
    if (error) return c.json({ error: error.message, deleted, partial: true,
      hint: "The audit snapshot covers every id that was planned, including any not yet deleted." }, 500);
    deleted += slice.length;
  }

  return c.json({ ok: true, object_type, summary: { ...summary, records_deleted: deleted },
    blocked,
    recovery: "The deleted payloads are in the audit activity for this operation (diff.deleted_records).",
  });
});

export { router as cleanRouter };
