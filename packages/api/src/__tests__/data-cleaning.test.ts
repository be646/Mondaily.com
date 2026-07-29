import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const clean = readFileSync(join(SRC, "routes/clean.ts"), "utf8");
const sql = readFileSync(join(SRC, "../../db/migrations/20260729_cross_type_duplicates.sql"), "utf8");

/**
 * Data cleaning — cross-type overlap. The existing DedupPanel only compares WITHIN one object type
 * by exact match, so it cannot see near-duplicate TYPES (person/people, contacts/contact-leads),
 * which is where this workspace's real ambiguity lives.
 */
describe("cleaning never destroys data unasked", () => {
  it("deletion lives ONLY in /dedupe-records — the scans stay pure reads", () => {
    // This guard used to assert `not.toMatch(/\.delete\(/)` across the whole file. /dedupe-records
    // deliberately broke that, so the invariant is now scoped rather than dropped: every delete
    // must sit inside that one handler, and the read endpoints must remain incapable of one.
    const dedupeStart = clean.indexOf('router.post("/dedupe-records"');
    expect(dedupeStart).toBeGreaterThan(0);
    const beforeDedupe = clean.slice(0, dedupeStart);
    expect(beforeDedupe).not.toMatch(/\.delete\(/);
    expect(clean).toMatch(/read_only: true/);          // the scans still say so
    // every SQL function is STABLE (read-only)
    const volatile = sql.match(/language sql (?!stable)/g) ?? [];
    expect(volatile).toHaveLength(0);
  });

  it("merge-types moves object_type — never record content", () => {
    // A type rename is reversible precisely because no field is combined and no value is chosen
    // between. The moment it touched `data`, it would stop being reversible.
    // Bounded slice: unbounded, this now runs on into /dedupe-records and would stop measuring
    // /merge-types at all.
    const start = clean.indexOf('router.post("/merge-types"');
    // End at whatever section comes NEXT, not at a named later one — this guard broke when
    // /repair-keys was added between merge-types and the dedupe section, silently widening the
    // slice to cover an endpoint it was never measuring.
    const end = clean.indexOf("\n// ── ", start);
    expect(end).toBeGreaterThan(start);
    const merge = clean.slice(start, end);
    const updates = merge.match(/\.update\(\{[^}]*\}\)/g) ?? [];
    expect(updates).toEqual(['.update({ object_type: to })']);
    expect(merge).not.toMatch(/\.delete\(/);
  });

  it("requires an admin and an explicit opt-out of dry-run", () => {
    expect(clean).toMatch(/router\.post\("\/merge-types", requireAdminRole/);
    // `dry_run !== false` means the destructive form must be ASKED for; a missing field is safe.
    expect(clean).toMatch(/dry_run !== false/);
  });

  it("refuses when the two types actually share records", () => {
    // Then it IS a record merge — duplicates would land inside one type — and this is the wrong
    // tool. Measured: the confusable pairs here share 0-2 records, which is why a rename suffices.
    expect(clean).toMatch(/would create duplicates inside/);
    expect(clean).toMatch(/status.*409|\}, 409\)/);
  });

  it("moves records in pages and reports what it did", () => {
    // An unbounded UPDATE is capped like every other unbounded statement here: it would move SOME
    // records and report success — the worst possible outcome for a schema change.
    const merge = clean.slice(clean.indexOf('router.post("/merge-types"'));
    expect(merge).toMatch(/\.limit\(500\)/);
    expect(merge).toMatch(/records_moved: moved/);
    expect(merge).toMatch(/reverse_with/);
  });
});

describe("cross-type overlap", () => {
  it("uses two independent signals with different confidence", () => {
    // An identical email is strong evidence of the same entity; embedding similarity is suggestive.
    // Reporting them together as one number would flatten that distinction.
    expect(sql).toMatch(/function cross_type_key_overlap/);
    expect(sql).toMatch(/function cross_type_semantic_overlap/);
    expect(clean).toMatch(/key_matches:/);
    expect(clean).toMatch(/semantic_matches:/);
  });

  it("compares pairs in ONE database join, not per-record round-trips", () => {
    // match_node_embeddings is query-vector -> top-k; cross-type needs A x B. Doing that in JS
    // would be one NN call per record — thousands of round-trips.
    expect(sql).toMatch(/from node_embeddings ea[\s\S]*?join node_embeddings eb/);
  });

  it("guards the deterministic matchers against junk collisions", () => {
    // Short phone fragments are extensions; short names are initials and "n/a" — both match
    // everything and would report a fake overlap.
    expect(sql).toMatch(/length\(a\.phone\) >= 7/);
    expect(sql).toMatch(/length\(a\.name\) >= 4/);
  });

  it("says when a scan was capped or a signal was unavailable", () => {
    // At the cap the real overlap is larger; silence would read as "these types barely overlap".
    expect(clean).toMatch(/truncated: keyPairs\.length >= max_pairs/);
    expect(clean).toMatch(/semantic_status/);
    expect(clean).toMatch(/skipped: embeddings not configured/);
  });

  it("counts distinct records, not pairs", () => {
    // One record can match several others; counting pairs overstates the overlap.
    expect(clean).toMatch(/records_in_a_with_a_match: distinctA\.size/);
  });

  it("counts object types in SQL, never by counting rows in JS", () => {
    // An unbounded select truncates past ~1000 rows — the bug behind the wallet reporting noise.
    // A cleaning tool whose own counts are wrong is worse than no tool.
    expect(sql).toMatch(/function object_type_counts/);
    expect(clean).toMatch(/rpc\("object_type_counts"/);
    // the fallback pages rather than trusting one big read
    expect(clean).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
  });
});

describe("within-type duplicate scan", () => {
  it("separates identity keys from mere resemblance", () => {
    // source_url and email identify an entity. A name does NOT — two different businesses can share
    // one — so it is reported separately and never presented as actionable on its own.
    expect(sql).toMatch(/function within_type_duplicate_groups/);
    expect(clean).toMatch(/strong_groups:/);
    expect(clean).toMatch(/weak_groups:/);
    expect(clean).toMatch(/two businesses can share a name/);
  });

  it("counts distinct redundant records, not group memberships", () => {
    // One record can appear in several groups (same email AND same name); summing group sizes
    // double-counts and overstates how much there is to clean.
    expect(clean).toMatch(/const redundant = new Set<string>\(\)/);
    expect(clean).toMatch(/redundant_records_by_strong_key: redundant\.size/);
  });

  it("is read-only like the rest of the analysis", () => {
    const scan = clean.slice(clean.indexOf('router.post("/duplicates"'), clean.indexOf('router.post("/merge-types"'));
    expect(scan).not.toMatch(/\.(delete|update|insert|upsert)\(/);
  });
});

describe("discovery cannot re-create the same lead", () => {
  const decisions = readFileSync(join(SRC, "routes/decisions.ts"), "utf8");

  it("checks for an existing record before creating one", () => {
    // ROOT CAUSE of 452 duplicate `person` records. The discovered-lead approval path called
    // createNode unconditionally. The Discovery monitor cron re-runs every 4 hours
    // (vercel.json "0 */4 * * *"), rediscovers the same leads, and with autonomy enabled those
    // decisions auto-approve — so each run minted another copy. Measured: 588 person records for
    // 136 distinct entities, worst offenders at exactly 18 copies on a clean 4-hour cadence.
    const branch = decisions.slice(decisions.indexOf('decision.agent_name === "discovery"'));
    expect(branch).toMatch(/DEDUP BEFORE CREATE/);
    expect(branch).toMatch(/skipping duplicate create/);
    // the existence check must run BEFORE the create, not after
    expect(branch.indexOf("const dedupKey")).toBeLessThan(branch.indexOf("ubc.createNode"));
  });

  it("keys on identity, never on name alone", () => {
    // source_url is the lead's identity; email is the fallback. Two different businesses can share
    // a name — deduping on it would silently drop real records.
    const branch = decisions.slice(decisions.indexOf('decision.agent_name === "discovery"'));
    expect(branch).toMatch(/lead\.source_url \? "source_url" : lead\.email \? "email" : null/);
    expect(branch).not.toMatch(/dedupKey = "name"/);
  });
});
