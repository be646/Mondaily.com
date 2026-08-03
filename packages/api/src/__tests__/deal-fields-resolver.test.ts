import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dealValueOf, dealValueKey, dealOwnerOf, dealOwnerKey } from "@mondaily/shared/deal-fields";
import { dealValue, dealOwner } from "../lib/money";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Value and owner, resolved once — the same fix as the stage.
 *
 * Measured in prod (44 deals): deal_value 27 / amount 5 / value 0 / arr 0, and
 * deal_owner 44 / owner 32 / assigned_to 3 / assignee 0.
 */
describe("a deal's value is read the same way everywhere", () => {
  it("falls through to `amount`, which five deals actually use", () => {
    // The record page read deal_value alone and showed "Not set" for these, while the AI panel and
    // the forecast on the same screen showed the figure and every report counted the money.
    expect(dealValueOf({ amount: 6000 })).toBe(6000);
    expect(dealValueOf({ deal_value: 700, amount: 1 })).toBe(700);
  });

  it("distinguishes a deal worth nothing from one that never said", () => {
    expect(dealValueOf({ deal_value: 0 })).toBe(0);
    expect(dealValueOf({})).toBeNull();
    expect(dealValueOf(null)).toBeNull();
  });

  it("edits land on the key the record already uses", () => {
    expect(dealValueKey({ amount: 6000 })).toBe("amount");
    expect(dealValueKey({})).toBe("deal_value");
  });

  it("the ledger delegates instead of keeping its own ordering", () => {
    // money.ts used to omit `arr` entirely.
    expect(dealValue({ amount: 6000 })).toBe(6000);
    expect(read("packages/api/src/lib/money.ts")).toMatch(/from "@mondaily\/shared\/deal-fields"/);
  });
});

describe("a deal's owner is read the same way everywhere", () => {
  it("is ordered by measured coverage, not by which name sounds official", () => {
    expect(dealOwnerOf({ deal_owner: "A", owner: "B", assigned_to: "C" })).toBe("A");
    expect(dealOwnerOf({ owner: "B", assigned_to: "C" })).toBe("B");
    expect(dealOwnerOf({})).toBe("");
  });

  it("the ledger and the group-by agree", () => {
    // money.ts preferred assigned_to over owner; aggregate.ts preferred owner over deal_owner. The
    // same deal could be attributed to two different people depending on which surface asked.
    const d = { deal_owner: "A", owner: "B", assigned_to: "C" };
    expect(dealOwner(d)).toBe(dealOwnerOf(d));
    expect(read("packages/api/src/lib/aggregate.ts")).toMatch(/dealOwnerOf\(d\)/);
  });

  it("returns text, never a member identity", () => {
    // assigned_to samples in prod: a raw UUID, "Bassem Epra", "Bassem Eprahim" — one of three
    // resolves to an actual member. A field NAMED like an owner is not one.
    expect(dealOwnerKey({ assigned_to: "10c0bcfb-2db4-458c-8fb3-9050e515acb9" })).toBe("assigned_to");
    expect(typeof dealOwnerOf({ assigned_to: "10c0bcfb" })).toBe("string");
  });
});

describe("open pipeline means AT a stage", () => {
  it("the ledger no longer counts unstaged deals as open", () => {
    expect(read("packages/api/src/lib/money.ts")).toMatch(/isOpen = \(stage: string\) => isOpenStage\(stage\)/);
  });
});
