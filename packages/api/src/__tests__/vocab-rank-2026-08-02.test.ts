import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  vocabSlotOf, vocabRank, vocabSortKey, vocabValues, vocabCanonical, vocabDirWords, vocabRankPairs,
  defaultSortFor,
} from "@mondaily/shared/vocab";

/**
 * Ordered categoricals must sort by MEANING. Alphabetically a pipeline reads
 * "Closed Lost, Closed Won, Lead, Negotiation" — an order that describes nothing.
 */
const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("slot detection", () => {
  it("recognises the many spellings these columns arrive under", () => {
    expect(vocabSlotOf("stage")).toBe("stage");
    expect(vocabSlotOf("deal_stage")).toBe("stage");
    expect(vocabSlotOf("Pipeline Stage")).toBe("stage");
    expect(vocabSlotOf("status")).toBe("status");
    expect(vocabSlotOf("priority")).toBe("priority");
  });

  it("leaves ordinary columns alone", () => {
    for (const c of ["name", "amount", "country", "owner", "email"]) expect(vocabSlotOf(c)).toBeNull();
  });

  it("a column that is both stage and status reads as stage — the pipeline wins", () => {
    expect(vocabSlotOf("stage_status")).toBe("stage");
  });
});

describe("rank is alias- and case-tolerant, because real data is messy", () => {
  it("maps every spelling of a won deal to the same rank", () => {
    const won = vocabRank("stage", "Closed Won");
    expect(vocabRank("stage", "closed won")).toBe(won);
    expect(vocabRank("stage", "closed-won")).toBe(won);
    expect(vocabRank("stage", "CLOSED_WON")).toBe(won);
    expect(vocabRank("stage", "  won  ")).toBe(won);
  });

  it("orders a pipeline the way a pipeline runs", () => {
    const seq = ["Lead", "Qualified", "Proposal", "Negotiation", "Closed Won"];
    const ranks = seq.map(s => vocabRank("stage", s)!);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(seq.length);
  });

  it("priority ascends Low → Urgent, so descending puts Urgent on top", () => {
    expect(vocabRank("priority", "Low")!).toBeLessThan(vocabRank("priority", "Urgent")!);
  });

  it("returns null for a value outside the vocabulary rather than guessing", () => {
    expect(vocabRank("stage", "Sent To Legal")).toBeNull();
  });
});

describe("sort keys place unknown and empty values honestly", () => {
  it("known values come first, then unknown values, then empty", () => {
    const known = vocabSortKey("stage", "Negotiation");
    const unknown = vocabSortKey("stage", "Sent To Legal");
    const empty = vocabSortKey("stage", "");
    expect(known).toBeLessThan(unknown);
    expect(unknown).toBeLessThan(empty);
    expect(vocabSortKey("stage", null)).toBe(empty);
  });

  it("sorting a real messy column produces pipeline order with the strays parked at the end", () => {
    const rows = ["Closed Won", "", "lead", "Sent To Legal", "negotiation", "Qualified"];
    const ordered = [...rows].sort((a, b) => vocabSortKey("stage", a) - vocabSortKey("stage", b) || a.localeCompare(b));
    expect(ordered).toEqual(["lead", "Qualified", "negotiation", "Closed Won", "Sent To Legal", ""]);
  });
});

describe("display + direction wording", () => {
  it("canonicalises a stored spelling without inventing one for unknown values", () => {
    expect(vocabCanonical("stage", "closed-won")).toBe("Closed Won");
    expect(vocabCanonical("stage", "Sent To Legal")).toBe("Sent To Legal");
  });

  it("direction words describe the axis, never the alphabet", () => {
    expect(vocabDirWords("stage", "asc")).toBe("Early→Late");
    expect(vocabDirWords("priority", "desc")).toBe("Urgent→Low");
    for (const slot of ["stage", "status", "priority"] as const) {
      for (const dir of ["asc", "desc"] as const) expect(vocabDirWords(slot, dir)).not.toMatch(/A→Z|Z→A/);
    }
  });

  it("exposes ordered option lists for pickers", () => {
    expect(vocabValues("stage")[0]).toBe("Lead");
    expect(vocabValues("priority")).toEqual(["Low", "Medium", "High", "Urgent"]);
  });

  it("rank pairs cover every alias so a SQL ranker matches what the client matches", () => {
    const pairs = vocabRankPairs("stage");
    for (const spelling of ["won", "closed-won", "lost", "lead", "prospect"]) {
      const pair = pairs.find(p => p.match === spelling);
      expect(pair, `${spelling} must be rankable in SQL`).toBeTruthy();
      expect(pair!.rank).toBe(vocabRank("stage", spelling));
    }
  });
});

describe("sheets open in the order their object is read", () => {
  it("deals arrive by pipeline position, then biggest money first", () => {
    expect(defaultSortFor("deals", ["name", "stage", "amount"])).toEqual([
      { col: "stage", dir: "asc" },
      { col: "amount", dir: "desc" },
    ]);
  });

  it("uses whichever spelling the sheet actually has", () => {
    expect(defaultSortFor("deals", ["name", "deal_stage", "deal_value"])).toEqual([
      { col: "deal_stage", dir: "asc" },
      { col: "deal_value", dir: "desc" },
    ]);
  });

  it("skips rules whose column is absent instead of inventing one", () => {
    expect(defaultSortFor("deals", ["name", "stage"])).toEqual([{ col: "stage", dir: "asc" }]);
    expect(defaultSortFor("deals", ["name"])).toEqual([]);
  });

  it("tasks lead with what is due soonest", () => {
    expect(defaultSortFor("tasks", ["name", "due_date", "priority"])[0]).toEqual({ col: "due_date", dir: "asc" });
  });

  it("lead lists are queues — freshest first, using the row's real timestamp", () => {
    expect(defaultSortFor("discovered-leads", ["name"])).toEqual([{ col: "__updated_at", dir: "desc" }]);
  });

  it("an object with no natural order is left alone", () => {
    expect(defaultSortFor("people", ["name", "email"])).toEqual([]);
    expect(defaultSortFor("custom_thing", ["name"])).toEqual([]);
  });

  it("never emits the same column twice — a duplicate rule is unrepresentable downstream", () => {
    const rules = defaultSortFor("deals", ["stage", "amount", "value"]);
    expect(new Set(rules.map(r => r.col)).size).toBe(rules.length);
  });

  it("seeds once per sheet and never overrides a sort the user already has", () => {
    const table = read("apps/app/src/components/records/record-table.tsx");
    expect(table).toMatch(/if \(sortRules\.length > 0\) return;/);
    expect(table).toMatch(/sortSeededFor\.current === objectType/);
  });
});

describe("the vocabulary has exactly one definition", () => {
  it("the create drawer reads the shared sets instead of keeping a private copy", () => {
    const index = read("apps/app/src/routes/dashboard/objects/[objectType]/index.tsx");
    expect(index).not.toMatch(/const CANON: Record<string, string\[\]>/);
    expect(index).toMatch(/vocabValues\(slot\)/);
  });

  it("sheet sort, grouping and the board all rank through it", () => {
    const table = read("apps/app/src/components/records/record-table.tsx");
    expect(table).toMatch(/const slot = vocabSlotOf\(col\)/);          // sort comparator
    expect(table).toMatch(/const groupSlot = vocabSlotOf\(groupByCol\)/); // group headers
    expect(read("apps/app/src/components/records/board-view.tsx")).toMatch(/vocabSortKey\(slot, s\)/);
  });
});

describe("row delete is guarded like bulk delete", () => {
  it("asks before permanently destroying a record", () => {
    const table = read("apps/app/src/components/records/record-table.tsx");
    expect(table).toMatch(/function deleteRow[\s\S]{0,700}window\.confirm/);
  });
});
