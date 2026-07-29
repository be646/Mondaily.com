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
describe("cleaning is read-only", () => {
  it("performs no mutation of any kind", () => {
    // Merging business records is destructive and irreversible. This session's recurring failure was
    // tools correct about the rows they fetched and wrong about what those rows represented — a
    // cleaner acting on that judgement is the worst version of it. It reports; a human decides.
    expect(clean).not.toMatch(/\.(delete|update|upsert|insert)\(/);
    expect(clean).toMatch(/read_only: true/);
    // and the SQL side is STABLE (read-only) throughout
    const volatile = sql.match(/language sql (?!stable)/g) ?? [];
    expect(volatile).toHaveLength(0);
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
