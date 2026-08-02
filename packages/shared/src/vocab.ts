/**
 * THE workspace vocabulary for ordered categorical fields.
 *
 * Stage, status and priority are not text — they are ORDERED sets. Sorting them alphabetically
 * produces "Closed Lost, Closed Won, Lead, Negotiation", which tells you nothing about a pipeline.
 * Grouping them by row count is just as arbitrary. Every surface that orders these values (sheet
 * sort, group headers, the board's column order, the create drawer's option pills) must read the
 * rank from HERE, so a deal board and a sorted sheet never disagree about what comes first.
 *
 * Values in the wild are messy: "closed won", "Closed-Won", "won", "Won " all occur in real data.
 * Ranking is therefore alias- and case-tolerant, and `canonicalize` maps a stored value to its
 * display form WITHOUT rewriting what is stored (that is a data decision, not a display one).
 */

export type VocabSlot = "stage" | "status" | "priority";

interface VocabEntry {
  /** Display form — what the UI shows and what new records are created with. */
  value: string;
  /** Lowercased spellings that mean the same thing in stored data. */
  aliases: string[];
}

/** Ordered — index IS the rank. Progression first, then terminal states, then parked. */
const VOCAB: Record<VocabSlot, VocabEntry[]> = {
  stage: [
    { value: "Lead",         aliases: ["lead", "new", "new lead", "prospect"] },
    // "discovery" and "contact" are measured spellings from the contact-leads and people sheets
    // (11 and 3 records). Both are pre-proposal qualification work, so they rank here rather than
    // sorting after every known stage as strangers to the pipeline.
    //
    // Deliberately NOT mapped, and this is the important half: "closed" (10 records) and
    // "in progress" (7). "closed" does not say won or lost — ranking it either way would move real
    // money into or out of a won column on a guess, and the two ranks are at opposite ends of the
    // pipeline. "in progress" is a STATUS word sitting in a stage field; it names no position.
    // Both stay unranked, which sorts them after the known stages and shows them as themselves.
    { value: "Qualified",    aliases: ["qualified", "qualified lead", "contacted", "contact", "discovery"] },
    { value: "Proposal",     aliases: ["proposal", "quote sent", "quoted"] },
    { value: "Negotiation",  aliases: ["negotiation", "negotiating", "in negotiation"] },
    { value: "Closed Won",   aliases: ["closed won", "closed-won", "won", "closed_won"] },
    { value: "Closed Lost",  aliases: ["closed lost", "closed-lost", "lost", "closed_lost", "rejected"] },
    { value: "On Hold",      aliases: ["on hold", "on-hold", "paused", "parked"] },
  ],
  status: [
    { value: "Not Started",  aliases: ["not started", "not-started", "todo", "to do", "open", "new"] },
    { value: "In Progress",  aliases: ["in progress", "in-progress", "in_progress", "active", "doing", "started"] },
    { value: "Completed",    aliases: ["completed", "complete", "done", "finished", "closed"] },
    { value: "On Hold",      aliases: ["on hold", "on-hold", "paused", "blocked"] },
    { value: "Cancelled",    aliases: ["cancelled", "canceled", "abandoned", "dropped"] },
  ],
  priority: [
    { value: "Low",          aliases: ["low", "p3", "minor"] },
    { value: "Medium",       aliases: ["medium", "normal", "p2", "med"] },
    { value: "High",         aliases: ["high", "p1", "major"] },
    { value: "Urgent",       aliases: ["urgent", "critical", "p0", "blocker"] },
  ],
};

/** Direction wording per slot — "A→Z" on a pipeline stage is meaningless. */
const DIR_WORDS: Record<VocabSlot, { asc: string; desc: string }> = {
  stage:    { asc: "Early→Late", desc: "Late→Early" },
  status:   { asc: "Open→Done",  desc: "Done→Open" },
  priority: { asc: "Low→Urgent", desc: "Urgent→Low" },
};

const lookup = new Map<VocabSlot, Map<string, number>>();
for (const slot of Object.keys(VOCAB) as VocabSlot[]) {
  const m = new Map<string, number>();
  VOCAB[slot].forEach((entry, i) => {
    m.set(entry.value.toLowerCase(), i);
    for (const a of entry.aliases) m.set(a, i);
  });
  lookup.set(slot, m);
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

/**
 * Which ordered slot (if any) a column name represents. Name-based on purpose: these columns
 * arrive from CSV, AI enrichment and hand-made sheets under many spellings, and the schema does
 * not yet mark semantic roles. `deal_stage`, `Stage`, `pipeline stage` are all the stage slot.
 */
export function vocabSlotOf(col: string): VocabSlot | null {
  const l = col.toLowerCase();
  if (/stage/.test(l)) return "stage";
  if (/priority/.test(l)) return "priority";
  if (/status/.test(l)) return "status";
  return null;
}

/** Rank of a value within its slot, or null when the value is not part of the known vocabulary. */
export function vocabRank(slot: VocabSlot, value: unknown): number | null {
  const r = lookup.get(slot)?.get(norm(value));
  return r == null ? null : r;
}

/**
 * Sort key for a value in an ordered column. Unknown values sort AFTER every known one (they are
 * real data — never hidden — but they cannot claim a position in a pipeline they aren't part of),
 * and empty sorts last of all. Ties among unknowns fall back to the caller's text compare.
 */
export function vocabSortKey(slot: VocabSlot, value: unknown): number {
  if (value == null || String(value).trim() === "") return Number.MAX_SAFE_INTEGER;
  const r = vocabRank(slot, value);
  return r == null ? Number.MAX_SAFE_INTEGER - 1 : r;
}

/** The ordered display values for a slot — the option list a picker should offer. */
export function vocabValues(slot: VocabSlot): string[] {
  return VOCAB[slot].map(e => e.value);
}

/** Map a stored value to its canonical display form; unknown values are returned untouched. */
export function vocabCanonical(slot: VocabSlot, value: unknown): string {
  const r = vocabRank(slot, value);
  return r == null ? String(value ?? "") : VOCAB[slot][r]!.value;
}

/** Direction words for a sort chip on an ordered column. */
export function vocabDirWords(slot: VocabSlot, dir: "asc" | "desc"): string {
  return DIR_WORDS[slot][dir];
}

/**
 * The order a sheet should ARRIVE in, by what the object means. An unsorted sheet is a pile: the
 * rows come back in whatever order the database returns them, which is not an answer to any
 * question a user has. These are defaults only — the moment someone sets their own sort it wins,
 * and it is never silently replaced.
 *
 * Columns are given as candidates because the same concept is spelled differently per sheet
 * (`deal_stage` vs `stage`, `amount` vs `value`); the first candidate that exists on the sheet is
 * used, and a rule whose column is absent is simply skipped.
 */
export interface DefaultSortRule { candidates: string[]; dir: "asc" | "desc" }

const DEFAULT_SORTS: { match: RegExp; rules: DefaultSortRule[] }[] = [
  // Pipeline first, biggest money first inside each stage — how a deal list is actually read.
  { match: /^deals?$/i,            rules: [{ candidates: ["deal_stage", "stage"], dir: "asc" }, { candidates: ["amount", "value", "deal_value"], dir: "desc" }] },
  // Money owed: largest outstanding first, then oldest.
  { match: /invoice/i,             rules: [{ candidates: ["status"], dir: "asc" }, { candidates: ["due_date", "date"], dir: "asc" }] },
  { match: /quote|credit.?note/i,  rules: [{ candidates: ["status"], dir: "asc" }, { candidates: ["date", "created_at"], dir: "desc" }] },
  { match: /expense/i,             rules: [{ candidates: ["status"], dir: "asc" }, { candidates: ["date"], dir: "desc" }] },
  // Work: what is due soonest, most urgent first.
  { match: /task|todo/i,           rules: [{ candidates: ["due_date", "due"], dir: "asc" }, { candidates: ["priority"], dir: "desc" }] },
  // Leads: freshest first — a lead list is a queue.
  { match: /lead|prospect/i,       rules: [{ candidates: ["__updated_at"], dir: "desc" }] },
];

/** The default sort rules for an object type, or [] when it has no meaningful natural order. */
export function defaultSortFor(objectType: string, availableCols: string[]): { col: string; dir: "asc" | "desc" }[] {
  const entry = DEFAULT_SORTS.find(d => d.match.test(objectType));
  if (!entry) return [];
  const have = new Set(availableCols);
  const out: { col: string; dir: "asc" | "desc" }[] = [];
  for (const rule of entry.rules) {
    const col = rule.candidates.find(c => have.has(c) || c === "__updated_at");
    if (col && !out.some(o => o.col === col)) out.push({ col, dir: rule.dir });
  }
  return out;
}

/**
 * Every recognised spelling paired with its rank — what a SQL ranker needs so ORDER BY can use a
 * CASE rank instead of a text compare, and the ordering survives paging. Flat (not index-based)
 * because several spellings share one rank.
 */
export function vocabRankPairs(slot: VocabSlot): { match: string; rank: number }[] {
  const seen = new Set<string>();
  return VOCAB[slot].flatMap((e, i) =>
    // The display value is usually also listed as an alias ("Lead"/"lead"), which sent the same
    // spelling twice in every query's rank array. Harmless to array_position, but it is payload.
    [e.value.toLowerCase(), ...e.aliases]
      .filter(m => !seen.has(m) && seen.add(m) !== undefined)
      .map(match => ({ match, rank: i })),
  );
}
