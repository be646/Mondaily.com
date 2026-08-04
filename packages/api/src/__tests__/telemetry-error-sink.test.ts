import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const APP = join(__dirname, "../../../../apps/app/src");

/**
 * Production errors used to go nowhere.
 *
 * The ErrorBoundary caught a render error, wrote console.error into a browser nobody was watching,
 * and showed a recovery card. Unless a user reported it, the failure was invisible — which is how
 * three of the defects found on 2026-08-04 survived: all silent, all looking like a 200.
 */
describe("the error sink is safe to expose", () => {
  const src = read("routes/telemetry.ts");

  it("is unauthenticated ON PURPOSE, and therefore bounded", () => {
    // An error thrown before auth resolves — bad session, broken bootstrap, chunk that will not
    // load — is the class most worth hearing about, and requiring a session would drop exactly
    // those. That makes it a public write, so it is capped like /public/ask.
    expect(src).toMatch(/rateLimit\(\{ max: \d+, windowMs: [\d_]+ \}\)/);
    expect(src).toMatch(/message: z\.string\(\)\.min\(1\)\.max\(2_000\)/);
    expect(src).toMatch(/route: z\.string\(\)\.max\(300\)/);
  });

  it("takes the workspace from the SESSION, never the body", () => {
    // Otherwise a caller could attribute errors to someone else's workspace and pollute their list.
    expect(src).toMatch(/c\.get\("workspaceId"\) \?\? null/);
    expect(src).not.toMatch(/body\.workspace|workspace_id: *body/);
  });

  it("dedupes by fingerprint so one throwing component cannot flood the table", () => {
    // A loop can throw on every render; a row per occurrence buries the signal in its own noise.
    expect(src).toMatch(/function fingerprint\(/);
    expect(src).toMatch(/replace\(\/\[0-9a-f\]\{8\}-/);   // ids normalised
    expect(src).toMatch(/\\b\\d\+\\b/);                    // numbers normalised
  });

  it("FAILS SOFT — the reporter must never become the outage", () => {
    expect(src).toMatch(/if \(error\) console\.error\("\[telemetry\]/);
    expect(src).toMatch(/return c\.json\(\{ recorded: !error, occurrences \}, 202\)/);
  });
});

describe("the client reports without endangering itself", () => {
  const eb = readFileSync(join(APP, "components/ui/error-boundary.tsx"), "utf8");

  it("reporting is best-effort and swallows its own failures", () => {
    expect(eb).toMatch(/\.catch\(\(\) => \{ \/\* never surface a reporting failure/);
    expect(eb).toMatch(/catch \{ \/\* never let reporting break the fallback render/);
  });

  it("uses keepalive so the report survives the chunk-error reload", () => {
    expect(eb).toMatch(/keepalive: true/);
  });

  it("uses the ONE definition of the API origin", () => {
    // Not a second copy of the same env expression, which is how two definitions drift.
    expect(eb).toMatch(/import \{ BASE_URL \} from "\.\.\/\.\.\/lib\/api-client"/);
  });
});

describe("stored is not the same as seen", () => {
  it("readiness reports unresolved errors, and null when the migration has not run", () => {
    const r = read("routes/admin-readiness.ts");
    expect(r).toMatch(/unresolved_client_errors/);
    expect(r).toMatch(/let unresolved_client_errors: number \| null = null/);
  });

  it("the migration PROVES the function runs, not merely that it compiles", () => {
    // rate_limit_hit installed cleanly and failed at call time; a green CREATE proved nothing.
    const sql = readFileSync(join(SRC, "../../db/migrations/20260804c_client_errors.sql"), "utf8");
    expect(sql).toMatch(/select \* from client_error_report\('selftest'/);
    expect(sql).toMatch(/returns table \(out_occurrences integer, out_first_seen timestamptz\)/);
  });
});

describe("dedup is verifiable from outside", () => {
  it("the response carries the running occurrence count", () => {
    // "recorded: true" twice proves the endpoint accepted twice, NOT that it collapsed them into
    // one row. A count that climbs while the row count does not is the actual evidence.
    const src = read("routes/telemetry.ts");
    expect(src).toMatch(/out_occurrences/);
    expect(src).toMatch(/occurrences \}, 202\)/);
  });
});

