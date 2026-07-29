import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { identityKey, pickSurvivor, richness, normName } from "../routes/clean";

const clean = readFileSync(join(__dirname, "../routes/clean.ts"), "utf8");

const node = (o: Partial<{ id: string; data: Record<string, unknown>; created_at: string; enriched_at: string | null; ai_summary: string | null; created_by: string | null }>) => ({
  id: o.id ?? "id", data: o.data ?? {}, created_at: o.created_at ?? "2026-07-01T00:00:00Z",
  enriched_at: o.enriched_at ?? null, ai_summary: o.ai_summary ?? null, created_by: o.created_by ?? "agent:discovery",
});

/**
 * /clean/dedupe-records is the only endpoint in the codebase that deletes business records, so its
 * decision logic is tested on behaviour, against the production data that motivated it — not on the
 * shape of the source.
 */
describe("identity requires a URL and a name together", () => {
  it("does NOT treat a shared source_url as a shared identity", () => {
    // THE case that overturned the first design. lawwarsaw.com carries both the firm and a lawyer
    // who works there — two real entities on one website. Keying on the URL alone deletes one.
    const firm   = { source_url: "http://www.lawwarsaw.com/", name: "Lemon, Keirn & Rovenstine, LLC" };
    const lawyer = { source_url: "http://www.lawwarsaw.com/", name: "W. Douglas Lemon" };
    expect(identityKey(firm)).not.toBe(identityKey(lawyer));
  });

  it("collapses punctuation and case variants of one entity", () => {
    // Observed: "Skin&Beauty" and "Skin & Beauty" on the same URL are one clinic.
    const a = { source_url: "https://skinandbeauty.superpharm.pl/", name: "Skin&Beauty" };
    const b = { source_url: "https://skinandbeauty.superpharm.pl/", name: "skin & beauty" };
    expect(identityKey(a)).toBe(identityKey(b));
  });

  it("leaves a record alone when either half is missing", () => {
    // No key means no deletion. Guessing at identity is how a cleaner destroys data.
    expect(identityKey({ name: "Acme" })).toBeNull();
    expect(identityKey({ source_url: "https://acme.com" })).toBeNull();
    expect(identityKey({ source_url: "https://acme.com", name: "ab" })).toBeNull(); // too short
    expect(identityKey(null)).toBeNull();
  });

  it("distinguishes different URLs with the same name", () => {
    // Two businesses genuinely can share a name.
    expect(identityKey({ source_url: "https://a.com", name: "Acme" }))
      .not.toBe(identityKey({ source_url: "https://b.com", name: "Acme" }));
  });

  it("normName strips only formatting, not distinguishing characters", () => {
    expect(normName("Skin & Beauty")).toBe(normName("Skin&Beauty"));
    expect(normName("Acme 2")).not.toBe(normName("Acme 3"));
  });
});

describe("the survivor is the richest copy, not the oldest", () => {
  it("keeps enrichment that landed on a later copy", () => {
    // Measured in production: the oldest copy was also the richest in only 11 of 71 groups, so
    // "keep the oldest" would have discarded enrichment on 60 entities.
    // Deliberately ADVERSARIAL to the tie-breakers: the thin copy is older AND flagged enriched AND
    // has a summary, so richness is the only signal that can pick the right row. An earlier version
    // of this test let `enriched_at` agree with richness, and deleting the richness comparator
    // entirely still passed — the assertion was decorative.
    const oldThin = node({ id: "old", created_at: "2026-07-01T00:00:00Z",
      enriched_at: "2026-07-01T01:00:00Z", ai_summary: "s", data: { name: "Acme", source_url: "u" } });
    const newRich = node({ id: "new", created_at: "2026-07-29T00:00:00Z",
      data: { name: "Acme", source_url: "u", job_title: "CEO", phone: "+1", industry: "SaaS" } });
    expect(pickSurvivor([oldThin, newRich]).id).toBe("new");
    expect(pickSurvivor([newRich, oldThin]).id).toBe("new");   // order must not matter
  });

  it("breaks a richness tie toward the enriched copy, then the oldest", () => {
    const plain    = node({ id: "plain",    created_at: "2026-07-05T00:00:00Z", data: { a: 1 } });
    const enriched = node({ id: "enriched", created_at: "2026-07-09T00:00:00Z", enriched_at: "x", data: { a: 1 } });
    expect(pickSurvivor([plain, enriched]).id).toBe("enriched");

    const older = node({ id: "older", created_at: "2026-07-01T00:00:00Z", data: { a: 1 } });
    const newer = node({ id: "newer", created_at: "2026-07-02T00:00:00Z", data: { a: 1 } });
    expect(pickSurvivor([older, newer]).id).toBe("older");
  });

  it("is deterministic, so a re-run picks the same survivor", () => {
    const g = [node({ id: "b", data: { a: 1 } }), node({ id: "a", data: { a: 1 } })];
    expect(pickSurvivor(g).id).toBe(pickSurvivor(g.slice().reverse()).id);
  });

  it("richness ignores empty values, so a padded-but-blank copy does not win", () => {
    // A record whose keys are all null/""/[]/{} carries nothing; counting raw key length would let
    // it beat a copy with real data.
    expect(richness(node({ data: { a: null, b: "", c: [], d: {} } }))).toBe(0);
    expect(richness(node({ data: { a: "real" } }))).toBe(1);
  });
});

describe("the guards that make an irreversible delete acceptable", () => {
  it("is admin-only and dry-run unless explicitly opted out", () => {
    expect(clean).toMatch(/router\.post\("\/dedupe-records", requireAdminRole/);
    const h = clean.slice(clean.indexOf('router.post("/dedupe-records"'));
    expect(h).toMatch(/dry_run !== false/);
  });

  it("refuses a group whose doomed copies have notes, tasks or edges", () => {
    // Attachment means something was built on that specific row and there is no merge capability to
    // carry it across. Refusing is the honest outcome, not a silent overwrite.
    const h = clean.slice(clean.indexOf('router.post("/dedupe-records"'));
    expect(h).toMatch(/withAttachments\.length/);
    expect(h).toMatch(/blocked\.push/);
    // all three surfaces are actually probed
    expect(h).toMatch(/from\("activities"\)/);
    expect(h).toMatch(/from\("tasks"\)/);
    expect(h).toMatch(/from_node_id/);
    expect(h).toMatch(/to_node_id/);
  });

  it("treats a FAILED attachment probe as fatal, never as 'nothing attached'", () => {
    // The single most dangerous silent failure available here: an errored probe returning no rows,
    // read as a clean bill of health, licensing the delete.
    const h = clean.slice(clean.indexOf('router.post("/dedupe-records"'));
    expect(h).toMatch(/Attachment check failed/);
    expect(h).toMatch(/cannot be treated as 'no attachments'/);
  });

  it("every activities insert supplies node_id — the column is NOT NULL", () => {
    // Caught in production: both audit inserts here omitted node_id. /dedupe-records failed loudly
    // (its own guard aborted before deleting anything) but /merge-types had swallowed the error with
    // `.then(() => {}, () => {})` and reported success with no audit row written at all.
    // The payload may be an inline literal OR a variable built earlier, so resolve the argument
    // instead of just reading forward — the first version of this guard only looked ahead and
    // therefore failed on `insert(auditRows)` while the code was correct.
    for (const m of clean.matchAll(/from\("activities"\)\s*\.insert\((\w+)?/g)) {
      const varName = m[1];
      const region = varName
        ? clean.slice(clean.indexOf(`const ${varName} =`), m.index! + 60)
        : clean.slice(m.index!, m.index! + 400);
      expect(region.length, `could not resolve payload for insert at ${m.index}`).toBeGreaterThan(60);
      expect(region, `activities insert at ${m.index} has no node_id`).toMatch(/node_id/);
    }
    // and no audit write may be fire-and-forget
    expect(clean).not.toMatch(/from\("activities"\)[\s\S]{0,300}\.then\(\(\) => \{\}, \(\) => \{\}\)/);
  });

  it("reports whether the merge-types audit actually landed", () => {
    expect(clean).toMatch(/audit_written: !auditErr/);
  });

  it("anchors each dedupe snapshot to the surviving record", () => {
    // So the copies a record absorbed appear on THAT record's timeline, where someone looking at it
    // would actually find them.
    const h = clean.slice(clean.indexOf('router.post("/dedupe-records"'));
    expect(h).toMatch(/node_id: p\.keep/);
    expect(h).toMatch(/copies_absorbed/);
  });

  it("writes the recovery snapshot BEFORE deleting, and aborts if it fails", () => {
    const h = clean.slice(clean.indexOf('router.post("/dedupe-records"'));
    expect(h.indexOf("deleted_records")).toBeLessThan(h.indexOf(".delete()"));
    expect(h).toMatch(/Could not write the audit snapshot/);
    expect(h).toMatch(/Nothing was deleted/);
  });

  it("pages the read, so it never dedupes page one and reports a total", () => {
    const h = clean.slice(clean.indexOf('router.post("/dedupe-records"'));
    expect(h).toMatch(/\.range\(from, from \+ PAGE - 1\)/);
  });
});
