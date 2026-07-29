import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = join(__dirname, "..");
const APP = join(__dirname, "../../../../apps/app/src");
const api = (p: string) => readFileSync(join(API, p), "utf8");
const app = (p: string) => readFileSync(join(APP, p), "utf8");

/**
 * The recurring theme across this codebase's audits: FAILURES THAT LOOK LIKE SUCCESS.
 * Each case below shipped as a silent no-op, a fabricated success, or an empty state standing in
 * for an error — so the user was told the opposite of what happened.
 */
describe("failures are never rendered as success or emptiness", () => {
  it("a failed goal dispatch does not render the green success panel", () => {
    const src = app("routes/dashboard/goals.tsx");
    // `catch { setDispatched(0) }` rendered a ✅ reading "Dispatched 0 steps to the decision queue".
    expect(src).not.toMatch(/catch\s*\{\s*setDispatched\(0\);?\s*\}/);
    expect(src).toMatch(/Could not dispatch this plan/);
  });

  it("fetch failures are distinguished from empty results", () => {
    // All three rendered "you have nothing" when the request had merely failed — and the
    // automations one invited the user to re-create work that already existed.
    expect(app("routes/dashboard/goals.tsx")).toMatch(/goalsQ\.isError/);
    expect(app("routes/dashboard/notifications.tsx")).toMatch(/query\.isError \?/);
    expect(app("routes/dashboard/automations/index.tsx")).toMatch(/failed=\{seqQuery\.isError\}/);
  });

  it("a workflow that failed to load cannot be overwritten by saving", () => {
    const src = app("routes/dashboard/automations/workflow-builder.tsx");
    // The load error was swallowed, leaving an empty builder; saving PATCHes { name, status, nodes }
    // which the API writes as the WHOLE data object — destroying the real definition.
    expect(src).toMatch(/if \(loadError\) \{/);
    expect(src).not.toMatch(/\.catch\(\(e\) => console\.error\("\[bg-task\] swallowed error:", e\)\);\s*\}, \[id\]\)/);
  });

  it("inline cell edits surface failures instead of silently reverting", () => {
    const src = app("components/records/record-table.tsx");
    // A viewer-role user (blocked by denyViewerWrites) watched their edit appear and vanish.
    expect(src).toMatch(/Couldn't save that change/);
  });

  it("server-side aggregate footers are refreshed after edits and deletes", () => {
    const src = app("components/records/record-table.tsx");
    // Sum/Avg totals come from ["records-agg"]/["records-group-agg"], which the optimistic
    // setQueryData on ["records"] never touched — so money totals stayed at their pre-edit values.
    expect(src).toMatch(/function invalidateAggregates/);
    expect(src).toMatch(/queryKey: \["records-agg"\]/);
    expect(src).toMatch(/queryKey: \["records-group-agg"\]/);
  });

  it("enrichment polling is cancelled on unmount", () => {
    const src = app("routes/dashboard/objects/[objectType]/index.tsx");
    // A 3s interval + 60s timeout were created in a useCallback with no cleanup, so navigating away
    // mid-enrichment kept polling and setting state on an unmounted tree.
    expect(src).toMatch(/enrichTimers/);
    expect(src).toMatch(/for \(const t of enrichTimers\.current\) clearTimeout/);
  });

  it("deleting an object type clears every cache holding it", () => {
    const src = app("routes/dashboard/objects/[objectType]/index.tsx");
    // GET /objects is cached under three keys; only one was invalidated.
    expect(src).toMatch(/\["sidebar-objects", "objects-schema", "object-defs"\]/);
  });
});

describe("auth lookups compare addresses exactly", () => {
  it("no ILIKE on email — % and _ are wildcards and are legal in a local-part", () => {
    const src = api("routes/auth.ts");
    // `%@corp.com` passes zod .email() and matched as a PATTERN under ilike: an account-existence
    // oracle, and simply the wrong comparison for an auth path.
    expect(src).not.toMatch(/\.ilike\("email"/);
    expect(src).toMatch(/\.eq\("email", email\.trim\(\)\.toLowerCase\(\)\)/);
  });

  it("the default workspace is deterministic", () => {
    // An unordered .limit(1) let a multi-workspace user boot into a different workspace per login.
    expect(api("routes/auth.ts")).toMatch(/\.order\("created_at", \{ ascending: true \}\)\.limit\(1\)\.maybeSingle\(\)/);
  });
});

describe("report scans are bounded", () => {
  const src = api("routes/reports.ts");

  it("pages instead of relying on an unbounded select", () => {
    // Past PostgREST's row cap an unbounded select returns an ARBITRARY SUBSET: the funnel then
    // undercounts which records reached a stage and reports an invented drop-off.
    expect(src).toMatch(/async function pagedSelect/);
    expect(src).toMatch(/const SCAN_CAP = 50_000/);
  });

  it("chunks node-id lists so the request URL can't blow up", () => {
    expect(src).toMatch(/async function activitiesForNodes/);
    expect(src).toMatch(/const CHUNK = 200/);
    // No remaining unbounded .in() over every node id at once.
    expect(src).not.toMatch(/\.in\("node_id", nodeIds\)/);
  });

  it("the historical report honours the configured range", () => {
    // This branch never touched `nodes`, so the range filter didn't apply: "Last 30 days" still
    // aggregated all-time.
    expect(src).toMatch(/if \(rangeDays\) q = q\.gte\("created_at"/);
  });

  it("the funnel reports no fabricated average_days", () => {
    expect(src).not.toMatch(/average_days: 0/);
  });
});

describe("billing actions are admin-gated and tiers come from the price", () => {
  it("buying credits and changing the plan require an admin", () => {
    const src = api("routes/billing.ts");
    expect(src).toMatch(/Only owners and admins can buy credits/);
    expect(src).toMatch(/Only owners and admins can change the plan/);
  });

  it("subscription tier resolves from the Stripe price, not stale metadata", () => {
    // metadata.plan is written once at creation: a portal-side upgrade changed the price but not
    // the metadata, and a subscription with no metadata resolved to "scout", downgrading a paying
    // customer while billing_status stayed "active".
    expect(api("lib/billing-tiers.ts")).toMatch(/export function tierFromPriceId/);
    const hook = api("routes/webhooks.ts");
    expect(hook).toMatch(/tierFromPriceId\(priceId\)/);
    expect(hook).toMatch(/if \(resolved && resolved !== "scout"\)/);
  });

  it("skipping onboarding no longer grants unlimited free AI", () => {
    const src = api("lib/credits.ts");
    // `if (!enrolled) return` waived metering entirely for any workspace with no ledger rows —
    // which is every workspace created without finishing onboarding.
    expect(src).toMatch(/await reconcileIncludedCredits\(workspaceId, \{ enrollIfEmpty: true \}\)/);
  });
});

describe("pricing is never restated outside the shared catalog", () => {
  it("the dead onboarding plan picker with invented prices is gone", () => {
    // step-plan.tsx hardcoded starter/pro/business/enterprise at $0/$49/$89 with invented limits
    // ("500 contacts", "Ask Mondaily AI (100/mo)"), against a real catalog of
    // scout/operator/command/sovereign at $0/$29/$79 — prices $20/mo too high under plan names that
    // do not exist. It also GET-ed /billing/checkout, which is POST-only. Unreferenced, but a live
    // footgun the moment anyone routed to it.
    const path = join(APP, "routes/onboarding/step-plan.tsx");
    expect(() => readFileSync(path, "utf8")).toThrow();
  });
});
