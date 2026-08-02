import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Task 3 — the invoice → lead/sheet link, built UNI-DIRECTIONAL.
 *
 * The spec asked for bi-directional sync: on payment, write status/paid_at/fx_rate onto linked
 * leads and sheet rows. That creates a second WRITABLE source of truth for the same money, which
 * drifts the moment either side is edited and can loop when both sides sync. The invoice stays the
 * sole writer; everything else reads a derived rollup, which cannot drift because it is recomputed.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const inv = () => read("packages/api/src/routes/invoices.ts");
const table = () => read("apps/app/src/components/records/record-table.tsx");

describe("nothing writes money onto a linked record", () => {
  it("the rollup is a GET — a read, not a sync", () => {
    expect(inv()).toMatch(/router\.get\("\/rollup"/);
  });

  it("no invoice handler writes a status or total onto the linked node", () => {
    const src = inv();
    // The only nodes.update calls in this file target the invoice itself.
    for (const chunk of src.split(".update(").slice(1)) {
      expect(chunk.slice(0, 400)).not.toMatch(/linked_record_id/);
    }
  });

  it("documents why bi-directional was rejected, so it is not 'fixed' later", () => {
    expect(inv()).toMatch(/UNI-DIRECTIONAL/);
    expect(inv()).toMatch(/second\s+\*?\s*writable\s*\*?\s*\n?\s*\*?\s*source of truth/i);
  });
});

describe("the rollup is keyed structurally, with the name as an admitted fallback", () => {
  it("returns both keyings", () => {
    const src = inv();
    expect(src).toMatch(/clients: byClient,/);
    expect(src).toMatch(/records: byRecord,/);
  });

  it("the sheet prefers the structural link over the name", () => {
    const src = table();
    expect(src).toMatch(/const byId = roll\?\.records\?\.\[record\.id\]/);
    expect(src).toMatch(/const entry = byId \?\? \(name \? roll\?\.clients\?\.\[name\] : undefined\)/);
  });

  it("a name match is marked as a guess, not presented as a link", () => {
    // Two records sharing a name would otherwise share a total, and renaming one empties it.
    expect(table()).toMatch(/entry && !byId && <span/);
    expect(table()).toMatch(/Matched by name, not linked/);
  });
});

describe("the rollup stops drifting with today's rate", () => {
  it("uses the frozen base value when the invoice carries one", () => {
    expect(inv()).toMatch(/if \(m\.modelled && m\.base_amount != null && \(m\.base_currency \?\? ""\)\.toUpperCase\(\) === base\.toUpperCase\(\)\)/);
  });

  it("reports how many figures were frozen vs converted live", () => {
    expect(inv()).toMatch(/basis: \{ frozen, live \}/);
  });

  it("records when the client last actually paid", () => {
    expect(inv()).toMatch(/if \(paid && \(!b\.last_paid_at \|\| paid > b\.last_paid_at\)\) b\.last_paid_at = paid/);
  });

  it("still uses the shared status definitions", () => {
    const src = inv();
    expect(src).toMatch(/if \(isBilled\(st\)\) b\.billed \+= amt/);
    expect(src).toMatch(/if \(isOutstanding\(st\)\) b\.outstanding \+= amt/);
  });
});
