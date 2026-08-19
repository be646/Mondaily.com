import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTransitions, alertEmail, type WatchdogState, type CheckResult } from "../lib/watchdog";

/**
 * The sovereign watchdog (launch-readiness item A4): production must TELL the operator it is
 * degrading, not wait for a user to. The properties pinned here are the ones that make an alert
 * system trustworthy: transitions not states (no 3am repeat-storm), alert-before-persist (a failed
 * send retries instead of being recorded as delivered), and the honest limit stated in the email.
 */

const at = (iso: string) => iso;
const ok = (name: string): CheckResult => ({ name, ok: true, detail: "reachable" });
const down = (name: string): CheckResult => ({ name, ok: false, detail: "no answer in 6s" });

describe("alerts fire on TRANSITIONS, never on steady state", () => {
  it("first run: failures alert, healthy checks do not", () => {
    const { transitions } = computeTransitions(null, [ok("database"), down("stt_appliance")], at("2026-08-19T10:00:00Z"));
    expect(transitions).toEqual([{ name: "stt_appliance", kind: "went_down", detail: "no answer in 6s" }]);
  });

  it("a check that STAYS down produces no second alert, and its `since` stands", () => {
    const prev: WatchdogState = { checks: { stt_appliance: { ok: false, since: "2026-08-19T09:00:00Z" } }, last_run: "2026-08-19T09:45:00Z" };
    const { transitions, next } = computeTransitions(prev, [down("stt_appliance")], at("2026-08-19T10:00:00Z"));
    expect(transitions).toEqual([]);
    expect(next.checks.stt_appliance!.since).toBe("2026-08-19T09:00:00Z");   // downtime clock keeps its start
  });

  it("recovery alerts once, carrying how long it was down", () => {
    const prev: WatchdogState = { checks: { mail_relay: { ok: false, since: "2026-08-19T09:00:00Z" } }, last_run: "2026-08-19T09:45:00Z" };
    const { transitions } = computeTransitions(prev, [ok("mail_relay")], at("2026-08-19T10:00:00Z"));
    expect(transitions).toEqual([{ name: "mail_relay", kind: "recovered", detail: "reachable", downSince: "2026-08-19T09:00:00Z" }]);
    const { subject, body } = alertEmail(transitions, [ok("mail_relay")], "2026-08-19T10:00:00Z");
    expect(subject).toBe("[Mondaily watchdog] mail_relay recovered");
    expect(body).toContain("recovered after ~60 min");
  });

  it("the DOWN email names every failing check in the subject and states the honest limit", () => {
    const t = computeTransitions(null, [down("database"), down("search_appliance")], at("2026-08-19T10:00:00Z")).transitions;
    const { subject, body } = alertEmail(t, [down("database"), down("search_appliance")], "2026-08-19T10:00:00Z");
    expect(subject).toBe("[Mondaily watchdog] database, search_appliance DOWN");
    expect(body).toContain("not its own total outage");
  });
});

describe("the machinery is wired the fail-closed way", () => {
  const lib = readFileSync(join(__dirname, "../lib/watchdog.ts"), "utf8");
  const appTs = readFileSync(join(__dirname, "../app.ts"), "utf8");
  const vercel = readFileSync(join(__dirname, "../../vercel.json"), "utf8");

  it("a 15-minute cron exists, fail-closed on CRON_SECRET", () => {
    expect(appTs).toContain('app.get("/api/cron/watchdog"');
    const block = appTs.slice(appTs.indexOf('app.get("/api/cron/watchdog"'));
    expect(block.slice(0, 500)).toContain("Cron disabled — CRON_SECRET is not configured");
    expect(vercel).toMatch(/"\/api\/cron\/watchdog",\s*"schedule":\s*"\*\/15 \* \* \* \*"/);
  });

  it("probes are LIVE with a timeout — env presence lied about the mail relay for a day once", () => {
    expect(lib).toContain("PROBE_TIMEOUT_MS");
    expect(lib).toContain("sovereignRelayStatus()");
    // Unconfigured dependency = a config choice, not an outage — never a false 3am page.
    expect(lib).toContain("not configured — not monitored");
  });

  it("alert goes out BEFORE state persists — a failed send retries instead of being recorded as delivered", () => {
    const alertIdx = lib.indexOf("await sendPlatformEmail(");
    const persistIdx = lib.indexOf("await writeState(next)");
    expect(alertIdx).toBeGreaterThan(-1);
    expect(alertIdx).toBeLessThan(persistIdx);
    expect(lib).toMatch(/if \(!alerted\) return \{ checks, transitions, alerted \};/);
  });

  it("recipients: PLATFORM_ADMIN_EMAILS, falling back to the owner allowlist — sovereign mail only", () => {
    expect(lib).toContain("PLATFORM_ADMIN_EMAILS");
    expect(lib).toContain("OWNER_EMAILS");
    expect(lib).toContain('localPart: "watchdog"');
  });
});

describe("B2/B3 instrumentation — measure before optimizing", () => {
  const owner = readFileSync(join(__dirname, "../routes/owner.ts"), "utf8");
  const consoleTsx = readFileSync(join(__dirname, "../../../../apps/app/src/routes/dashboard/owner-console.tsx"), "utf8");
  const readiness = readFileSync(join(__dirname, "../routes/admin-readiness.ts"), "utf8");

  it("cache hit-rate is computed ONLY over calls where the provider reported a status", () => {
    expect(owner).toMatch(/if \(cs === "hit" \|\| cs === "miss"\) \{ b\.cache_known\+\+; if \(cs === "hit"\) b\.cache_hits\+\+; \}/);
    expect(consoleTsx).toContain("cache_known ?? 0) > 0");   // unknown → no fabricated 0%
  });

  it("embeddings readiness is LIVE (round-trip + this workspace's index count), not env presence", () => {
    expect(readiness).toContain('await embedOne("readiness probe")');
    expect(readiness).toMatch(/from\("node_embeddings"\)[\s\S]{0,120}count: "exact", head: true/);
    // configured-but-dead (or indexing nothing) reads PARTIAL — fail-soft hides it everywhere else.
    expect(readiness).toMatch(/embeddings_live && \(embeddings_indexed_rows \?\? 0\) > 0 \? "ready" : "partial"/);
  });
});
