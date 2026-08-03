import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderProposalTable, type WinProposal } from "../lib/backfill-wins";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const backfill = () => read("packages/api/src/lib/backfill-wins.ts");
const rebase = () => read("packages/api/src/lib/rebase-currency.ts");

const proposal = (o: Partial<WinProposal>): WinProposal => ({
  deal_id: "d1234567-aaaa", title: "Acme", amount: 1000,
  proposed_closed_at: null, source: "no_evidence", evidence_detail: "none", ...o,
});

/**
 * A close date must come from evidence that the deal actually closed then. `created_at` answers
 * "when was the row made" and `updated_at` "when was it last written" — both are facts about the
 * database, not the business.
 */
describe("the backfill proposes only what evidence supports", () => {
  it("REFUSES created_at as a fallback, and says why", () => {
    // The brief asked for it as a "conservative baseline". It is not conservative: it is a
    // fabricated business event with a plausible timestamp, and strictly worse than the current
    // honest disclosure — a wrong number nobody can detect beats no number every time, backwards.
    const src = backfill();
    expect(src).toMatch(/created_at is not evidence of when it was won/);
    expect(src).toMatch(/source: "no_evidence"/);
    // It must never quietly reach for the row's own timestamps.
    expect(src).not.toMatch(/proposed_closed_at: .*created_at/);
    expect(src).not.toMatch(/proposed_closed_at: .*updated_at/);
  });

  it("requires a transition INTO won — an edit while already won is not the moment it was won", () => {
    const src = backfill();
    expect(src).toMatch(/if \(nowWon && !wasWon\)/);
  });

  it("takes the EARLIEST qualifying transition, since later ones are re-saves", () => {
    expect(backfill()).toMatch(/\.order\("created_at", \{ ascending: true \}\)/);
  });

  it("ranks operator-supplied above inference, and records it as a human decision", () => {
    const src = backfill();
    expect(src).toMatch(/source: "operator_supplied"/);
    expect(src).toMatch(/supplied by an operator for this deal/);
  });

  it("never overwrites a real close date discovered between the dry run and the commit", () => {
    // The one silent overwrite this whole exercise exists to prevent.
    expect(backfill()).toMatch(/if \(data\.won_at\) \{ skipped\+\+; continue; \}/);
  });

  it("marks a backfilled date so it can be told from one stamped at the win", () => {
    expect(backfill()).toMatch(/won_at_source: p\.source, won_at_backfilled: true/);
  });
});

describe("the dry-run table reads as a review, not as JSON", () => {
  it("renders the requested columns", () => {
    const out = renderProposalTable([proposal({ proposed_closed_at: "2026-06-15T10:00:00.000Z", source: "stage_transition" })]);
    for (const h of ["DEAL ID", "TITLE", "AMOUNT", "PROPOSED CLOSED_AT", "SOURCE"]) expect(out).toContain(h);
    expect(out).toContain("stage_transition");
  });

  it("shows an explicit '— none —' rather than a blank where no date is proposed", () => {
    const out = renderProposalTable([proposal({})]);
    expect(out).toContain("— none —");
    expect(out).toContain("1 undated win(s) · 0 with evidence · 1 without");
  });

  it("states the reason undated deals were left alone", () => {
    expect(renderProposalTable([proposal({})])).toContain("created_at is when the row was made, not when the deal was won");
  });
});

describe("rebasing moves the base side only, at each record's own date", () => {
  it("converts at the record's transaction date, never today's", () => {
    // Re-deriving a year of history at this morning's rate makes every past month depend on when
    // the migration happened to run — the drift the frozen fields exist to end.
    const src = rebase();
    expect(src).toMatch(/function transactionDate/);
    expect(src).toMatch(/loadRatesAsOf\(as_of\)/);
    expect(src).not.toMatch(/loadRates\(\)/);
  });

  it("never writes presentment", () => {
    // Scoped to the UPDATE payload: the plan READS presentment to report it, which is fine. What
    // must never happen is the migration writing it.
    const src = rebase();
    const update = src.slice(src.indexOf(".update({"), src.indexOf("}).eq(\"workspace_id\", workspaceId).eq(\"id\", row.id)"));
    expect(update).not.toMatch(/amount_presentment:/);
    expect(update).not.toMatch(/currency_presentment:/);
    expect(update).toMatch(/\.\.\.d,\s*\/\/ presentment survives verbatim/);
  });

  it("BLOCKS a row with no rate instead of reaching for a nearby day", () => {
    // Inventing a rate puts a number in the ledger no source supports.
    expect(rebase()).toMatch(/blocked = `no stored rate for/);
  });

  it("caches per date, so a thousand invoices in one month cost one lookup", () => {
    expect(rebase()).toMatch(/rateCache/);
  });

  it("records where a rebased figure came from", () => {
    expect(rebase()).toMatch(/rebased_from: row\.old_currency_base/);
  });

  it("is owner-gated and dry-run by default", () => {
    const src = read("packages/api/src/routes/currency.ts");
    expect(src).toMatch(/dry_run: z\.boolean\(\)\.default\(true\)/);
    expect(src).toMatch(/role !== "owner" && role !== "admin"/);
    expect(src).toMatch(/amount_presentment and currency_presentment are never modified/);
  });
});

describe("no third-party FX provider was introduced", () => {
  it("rates still come from the sovereign ECB feed we already cache", () => {
    // The brief named OpenExchangeRates / ExchangeRate-API; that contradicts the standing
    // no-third-party-integrations rule, and we already fetch and cache ECB ourselves.
    const all = rebase() + read("packages/api/src/lib/currency-store.ts");
    expect(all).not.toMatch(/openexchangerates|exchangerate-api/i);
    expect(all).toMatch(/source: "ecb"/);
  });
});

describe("the activities feed honours node_id", () => {
  it("filters by node, instead of returning the workspace feed", () => {
    // Found while sourcing evidence: every deal appeared to have 50 activities and had none.
    const src = read("packages/api/src/routes/activities.ts");
    expect(src).toMatch(/if \(nodeId\) q = q\.eq\("node_id", nodeId\)/);
  });
});
