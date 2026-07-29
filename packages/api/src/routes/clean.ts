import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "../middleware/auth";
import { supabase } from "@mondaily/db/client";
import { isEmbeddingsEnabled } from "../lib/embeddings";
import { requireAdminRole } from "../middleware/rbac";

/**
 * DATA CLEANING — cross-type overlap analysis, and the one repair it justified.
 *
 * NOTHING HERE DELETES A RECORD OR EDITS RECORD CONTENT. The scans are pure reads. The single
 * mutating endpoint (/merge-types) changes `object_type` and nothing else — no field is combined,
 * no value is chosen between, no row is removed — which is what makes it reversible.
 *
 * That restraint is deliberate. Merging business records is irreversible, and this session's
 * recurring failure was tools that were correct about the rows they fetched and wrong about what
 * those rows REPRESENTED. A cleaner acting on that judgement is the worst version of it. So the
 * analysis reports with evidence and a human decides.
 *
 * It also earned its scope empirically: the first scan showed person(588)/people(138) share 2
 * records and company/companies, tasks/task, expenses/expense and contacts/contact-leads share
 * NONE. There was no record-level duplication to merge — only duplicate type NAMES — so a
 * record-merge engine was never built.
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
      const { data: rows } = await supabase.from("nodes").select("id, data").in("id", ids.slice(i, i + 200));
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

  await supabase.from("activities").insert({
    workspace_id: ws, actor_type: "human", actor_id: c.get("userId"), action: "updated",
    diff: { data_cleaning: "merge_types", from, to, records_moved: moved },
  }).then(() => {}, () => {});

  return c.json({ ok: true, from, to, records_moved: moved, now_in_target: moved + toCount,
    reverse_with: { from: to, to: from, dry_run: false },
    caveat: `Reversing moves ALL ${moved + toCount} records in "${to}", including the ${toCount} that were already there.` });
});

function errOf(e: unknown): string | null {
  return e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : null;
}

export { router as cleanRouter };
