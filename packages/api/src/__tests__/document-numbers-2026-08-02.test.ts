import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const lib = () => read("packages/api/src/lib/document-numbers.ts");
const sql = () => read("packages/db/migrations/20260802_document_numbers.sql");

/**
 * A duplicate invoice number is discovered by a customer, not by us. These tests are about the two
 * ways the old implementation could produce one.
 */
describe("numbers are claimed atomically, not read-then-written", () => {
  it("allocates through the counter function, in one statement", () => {
    expect(lib()).toMatch(/supabase\.rpc\("next_document_number"/);
    expect(sql()).toMatch(/on conflict \(workspace_id, doc_type\) do update/);
  });

  it("the counter can only ever move FORWARD, so a concurrent caller cannot reuse a number", () => {
    expect(sql()).toMatch(/set next_value = greatest\(dc\.next_value, greatest\(p_seed, 0\) \+ 1\) \+ 1/);
  });

  it("no route computes a number for itself any more", () => {
    for (const f of ["packages/api/src/routes/invoices.ts", "packages/api/src/routes/quotes.ts"]) {
      expect(read(f)).not.toMatch(/order\("data->>number"/);
      expect(read(f)).not.toMatch(/async function next(Seq|Invoice|Quote)Number/);
    }
  });
});

describe("the seed keeps an existing series going", () => {
  it("reads the highest issued number NUMERICALLY, not as text", () => {
    // The old read ordered by data->>number, a text sort over a 4-padded value: 'INV-9999' sorts
    // above 'INV-10000', so document 10,000 would restart the series onto numbers already issued.
    const src = lib();
    // The CALL, not the word — the note above explains the bug by naming the old ordering.
    expect(src).not.toMatch(/\.order\("data->>number"/);
    expect(src).toMatch(/if \(Number\.isFinite\(n\) && n > highest\) highest = n/);
  });

  it("pages the read, so a big workspace's max is not the max of page one", () => {
    expect(lib()).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
  });

  it("passes the seed on EVERY call, so a later import cannot be overtaken", () => {
    const src = lib();
    expect(src).toMatch(/const seed = await highestIssued\(workspaceId, objectType\)/);
    expect(sql()).toMatch(/applied with GREATEST on every call/);
  });
});

describe("it fails loudly rather than falling back", () => {
  it("throws when the counter is unavailable instead of reverting to read-then-add", () => {
    // A fallback would silently restore the race at exactly the moment something is already wrong.
    const src = lib();
    expect(src).toMatch(/if \(error\) throw new Error\(`Could not allocate a \$\{objectType\} number/);
    expect(src).toMatch(/if \(!Number\.isFinite\(n\) \|\| n <= 0\) throw/);
  });

  it("does not hand the counter to the browser's roles", () => {
    expect(sql()).toMatch(/revoke all on function next_document_number\(text, text, bigint\) from public, anon, authenticated/);
    expect(sql()).toMatch(/grant execute on function next_document_number\(text, text, bigint\) to service_role/);
  });
});

describe("the lesson from the first live attempt", () => {
  it("uses p_-prefixed parameters — a bare doc_type is ambiguous against the column", () => {
    // The function installed cleanly and then failed on EVERY call: plpgsql resolves the
    // ambiguity at call time, not at create time, so "Success, no rows returned" proved nothing.
    const src = sql();
    expect(src).toMatch(/p_ws text,\s*\n\s*p_doc_type text,\s*\n\s*p_seed bigint/);
    expect(src).toMatch(/drop function if exists next_document_number\(text, text, bigint\)/);
    expect(read("packages/api/src/lib/document-numbers.ts")).toMatch(/p_ws: workspaceId,\s*\n\s*p_doc_type: objectType,\s*\n\s*p_seed: seed,/);
  });

  it("returns the real reason instead of a bare Internal Server Error", () => {
    // The first failure gave no clue which of the four moving parts had broken.
    for (const f of ["packages/api/src/routes/invoices.ts", "packages/api/src/routes/quotes.ts"]) {
      expect(read(f)).toMatch(/catch \(e\) \{\s*\n\s*return c\.json\(\{ error: e instanceof Error \? e\.message/);
    }
  });
});
