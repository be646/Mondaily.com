import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { withStageStamps, dealStageOf } from "../lib/stage-stamps";

const root = join(__dirname, "../../../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, ext: string[], out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (e === "node_modules" || e === "dist" || e === ".next") continue;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, ext, out);
    else if (ext.some(x => e.endsWith(x))) out.push(rel);
  }
  return out;
}

/**
 * Monorepo audit, 2026-08-03. Two orphans were found by sweeping rather than by reasoning, and
 * both are the same shape: a rule enforced at one writer and bypassed by another.
 */
describe("close-date stamping has exactly ONE implementation", () => {
  it("stamps won_at only on the TRANSITION into won", () => {
    const stamped = withStageStamps("deals", { stage: "Negotiation" }, { stage: "Closed Won" }, () => "2026-08-03T00:00:00.000Z");
    expect(stamped.won_at).toBe("2026-08-03T00:00:00.000Z");
    // Re-saving an already-won deal must never refresh the date, or "closed this month" walks
    // forward every time somebody edits the record.
    const resaved = withStageStamps("deals", { stage: "Closed Won", won_at: "2026-06-01T00:00:00.000Z" }, { stage: "Closed Won", note: "x" }, () => "2026-08-03T00:00:00.000Z");
    expect(resaved.won_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("stamps lost_at the same way", () => {
    const s = withStageStamps("deals", { stage: "Proposal" }, { stage: "Closed Lost" }, () => "2026-08-03T00:00:00.000Z");
    expect(s.lost_at).toBe("2026-08-03T00:00:00.000Z");
  });

  it("CARRIES FORWARD an existing stamp, because both writers replace data wholesale", () => {
    // A client that fetched the record before the stamp existed and edits any other field would
    // otherwise silently erase a server-stamped fact.
    const s = withStageStamps("deals", { stage: "Closed Won", won_at: "2026-05-05T00:00:00.000Z" }, { stage: "Closed Won" });
    expect(s.won_at).toBe("2026-05-05T00:00:00.000Z");
  });

  it("ignores non-deal objects entirely", () => {
    const s = withStageStamps("invoice", { status: "sent" }, { status: "paid" });
    expect(s.won_at).toBeUndefined();
  });

  it("reads the stage from every spelling the data uses", () => {
    expect(dealStageOf({ deal_stage: "Closed Won" })).toBe("Closed Won");
    expect(dealStageOf({ stage: "Lead" })).toBe("Lead");
    expect(dealStageOf({ status: "Qualified" })).toBe("Qualified");
  });

  it("BOTH writers call it — the REST path and the workflow engine", () => {
    // ORPHAN FOUND BY THIS AUDIT: the workflow engine's update_field action writes nodes.data
    // straight to Supabase and could set a stage to "Closed Won" without passing through the REST
    // stamp — an automation manufacturing the exact undated win the money model excludes.
    expect(read("packages/api/src/routes/nodes.ts")).toMatch(/updates\.data = withStageStamps\(/);
    expect(read("packages/api/src/jobs/workflow-engine.ts")).toMatch(/const stamped = withStageStamps\(record\.object_type, record\.data, merged\)/);
  });

  it("no writer re-implements the stamp inline", () => {
    for (const f of ["packages/api/src/routes/nodes.ts", "packages/api/src/jobs/workflow-engine.ts"]) {
      expect(read(f), f).not.toMatch(/nextData\.won_at = new Date\(\)\.toISOString\(\)/);
    }
  });
});

describe("every reporting month is the WORKSPACE's month", () => {
  it("the executive brief resolves the calendar per workspace, not from the process timezone", () => {
    // ORPHAN FOUND BY THIS AUDIT: the monthly brief computed its boundary with
    // new Date(y, m-1, 1) — UTC on Vercel — so the emailed month could differ from the workspace's
    // own Reports and its filed snapshot. An email is the one artefact a reader cannot cross-check.
    const src = read("packages/api/src/jobs/executive-brief.ts");
    expect(src).toMatch(/const cfg = workspacePeriodConfig\(w as/);
    expect(src).toMatch(/pastPeriodBounds\("MONTH", now, cfg, -1\)/);
    expect(src).not.toMatch(/new Date\(now\.getFullYear\(\), now\.getMonth\(\) - 1, 1\)/);
  });

  it("no reporting surface computes a month from the process timezone", () => {
    // Billing/credit-period code is DELIBERATELY excluded: when a credit allowance resets is an
    // entitlement question anchored to the billing cycle, not a reporting-calendar question, and
    // silently moving it would move when customers get their credits.
    const REPORTING = [
      "packages/api/src/lib/money.ts", "packages/api/src/lib/outcomes.ts",
      "packages/api/src/lib/period-close.ts", "packages/api/src/routes/briefing.ts",
      "packages/api/src/routes/owner.ts", "packages/api/src/routes/activities.ts",
      "packages/api/src/jobs/executive-brief.ts",
    ];
    for (const f of REPORTING) {
      expect(read(f), f).not.toMatch(/new Date\([^)]*getFullYear\(\)[^)]*getMonth\(\)[^)]*, *1\)/);
    }
  });
});

describe("presentment is never overwritten anywhere in the repo", () => {
  it("no code path assigns amount_presentment outside record creation and the rebase READ", () => {
    const writers = walk("packages/api/src", [".ts"])
      .filter(f => !f.includes("__tests__"))
      .filter(f => /\.update\(\{[\s\S]{0,400}amount_presentment/.test(read(f)));
    expect(writers).toEqual([]);
  });

  it("the rebase writes the base side only", () => {
    const src = read("packages/api/src/lib/rebase-currency.ts");
    const update = src.slice(src.indexOf(".update({"), src.indexOf('}).eq("workspace_id", workspaceId).eq("id", row.id)'));
    expect(update).not.toMatch(/amount_presentment:|currency_presentment:/);
  });
});

describe("the operator console carries no pre-redesign artifacts", () => {
  const APP = walk("apps/app/src", [".tsx"]).map(f => ({ f, s: read(f) }));

  it("no rounded-2xl or rounded-3xl", () => {
    expect(APP.filter(x => /rounded-(2xl|3xl)/.test(x.s)).map(x => x.f)).toEqual([]);
  });

  it("elevation survives ONLY where a panel floats over video", () => {
    // A shadow separating a control panel from moving video is functional, not decorative.
    const shadowed = APP.filter(x => /shadow-2xl/.test(x.s)).map(x => x.f);
    expect(shadowed.every(f => f.includes("call-"))).toBe(true);
  });

  it("bright greens survive ONLY as status dots and alpha badges", () => {
    // Semantic colour. Status green is meaning, not decoration, and must not be tokenised away.
    const green = APP.filter(x => /bg-(green|emerald)-[45]00(?!\/)/.test(x.s)).map(x => x.f);
    expect(green.every(f => f.includes("onboarding") || f.includes("call-"))).toBe(true);
  });
});

describe("AUDIT PASS 2 — raw CSS radii, which pass 1 never checked", () => {
  const css = () => read("apps/app/src/styles.css");

  it("the primary input console uses the sm token, per spec", () => {
    // Pass 1 swept Tailwind rounded-* classes in .tsx and never looked at styles.css, so
    // .ask-input sat at 0.75rem — 12px, larger than --radius-lg and outside the scale entirely.
    expect(css()).toMatch(/\.ask-input \{[\s\S]{0,200}border-radius: var\(--radius-sm\)/);
  });

  it("the composer family is ON the scale, not four different hand-picked values", () => {
    // .ask-input .75 / .ai-composer 1 / .suggestion-row .75 / .chat-suggestion-row .7 /
    // .chat-action .6 — five selectors in one family, four different radii. That is drift.
    const src = css();
    for (const sel of [".ai-composer", ".suggestion-row", ".chat-suggestion-row", ".chat-action"]) {
      const m = new RegExp(`\\${sel} \\{[\\s\\S]{0,300}?border-radius: var\\(--radius-(sm|md|lg)\\)`);
      expect(src, sel).toMatch(m);
    }
  });

  it("no radius in the console stylesheet sits outside the scale", () => {
    const ALLOWED = new Set(["9999px", "50%", "inherit", "4px",
      "var(--radius-sm)", "var(--radius-md)", "var(--radius-lg)", "var(--radius-pill)"]);
    const found = [...css().matchAll(/border-radius: *([^;]+);/g)].map(m => m[1]!.trim());
    const off = [...new Set(found)].filter(v => !ALLOWED.has(v));
    // 4px is grandfathered: the settings grid documents "sharp architectural corners" and sits
    // between sm and md by intent, not by drift.
    expect(off).toEqual([]);
  });

  it("the dead Tailwind radius shim is gone, with zero usages to justify it", () => {
    const src = css();
    expect(src).not.toMatch(/\.rounded-2xl *\{ *border-radius/);
    const tsx = walk("apps/app/src", [".tsx"]).map(read).join("\n");
    expect(tsx).not.toMatch(/rounded-(xl|2xl|3xl)\b/);
  });

  it("the input keeps a 1px border and an emerald focus ring", () => {
    const src = css();
    expect(src).toMatch(/\.ask-input \{[\s\S]{0,200}border: 1px solid var\(--border-soft\)/);
    expect(src).toMatch(/\.ask-input:focus-within \{[\s\S]{0,200}border-color: var\(--section-accent\)/);
  });
});
