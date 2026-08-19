import { supabase } from "@mondaily/db/client";
import { sendPlatformEmail, sovereignRelayStatus } from "./mail";
import { OWNER_EMAILS } from "./owner";

/**
 * The sovereign watchdog — the machinery that TELLS the operator when production degrades,
 * instead of a user telling them.
 *
 * Design:
 *   - LIVE probes, not env presence. The readiness inspector already learned this lesson the hard
 *     way: env presence reported a healthy mail relay for a day while the appliance was
 *     unreachable. Every check here talks to the real dependency with a short timeout.
 *   - Alerts on TRANSITIONS, not states. State lives in a private storage object
 *     (platform-state/watchdog.json) — no migration, same pattern as the report archive — so a
 *     check that is down for six hours produces one DOWN email and one RECOVERED email, not
 *     twenty-four repeats. No state readable → treated as first run, alerts only on failures.
 *   - Alerts travel over the SOVEREIGN mail path (sendPlatformEmail), to PLATFORM_ADMIN_EMAILS,
 *     falling back to the owner allowlist. No third-party pager.
 *   - HONEST LIMIT, stated here and in every email footer: this runs inside the API itself. It
 *     can see a degraded dependency; it cannot see its own total outage (nothing left to run the
 *     cron). External probing needs one of the appliance boxes and is a separate build.
 */

export interface CheckResult { name: string; ok: boolean; detail: string }
export interface WatchdogState {
  /** check name → { ok, since } — `since` is when the check ENTERED its current state. */
  checks: Record<string, { ok: boolean; since: string }>;
  last_run: string;
}

export const STATE_BUCKET = "platform-state";
const STATE_PATH = "watchdog.json";
const PROBE_TIMEOUT_MS = 6_000;

async function probeUrl(name: string, base: string | undefined, path = "/health"): Promise<CheckResult> {
  const url = (base ?? "").trim().replace(/\/$/, "");
  if (!url) return { name, ok: true, detail: "not configured — not monitored" }; // absence is a config choice, not an outage
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    const r = await fetch(`${url}${path}`, { signal: ctl.signal });
    clearTimeout(t);
    return { name, ok: r.ok, detail: r.ok ? `HTTP ${r.status}` : `HTTP ${r.status}` };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error && e.name === "AbortError" ? `no answer in ${PROBE_TIMEOUT_MS / 1000}s` : String(e).slice(0, 120) };
  }
}

/** Every probe is wrapped: a check that THROWS is a failed check, never a crashed sweep. */
export async function runChecks(): Promise<CheckResult[]> {
  const results = await Promise.all([
    // Database — the query itself is the probe.
    (async (): Promise<CheckResult> => {
      try {
        const { error } = await supabase.from("workspaces").select("id", { count: "exact", head: true }).limit(1);
        return { name: "database", ok: !error, detail: error ? error.message.slice(0, 120) : "reachable" };
      } catch (e) { return { name: "database", ok: false, detail: String(e).slice(0, 120) }; }
    })(),
    // Sovereign mail relay — reuses the same reachability check the readiness inspector trusts.
    (async (): Promise<CheckResult> => {
      try {
        const s = await sovereignRelayStatus();
        if (!s.configured) return { name: "mail_relay", ok: true, detail: "not configured — not monitored" };
        if (!s.checkable) return { name: "mail_relay", ok: false, detail: "health endpoint unreachable" };
        return { name: "mail_relay", ok: s.reachable, detail: s.reachable ? "reachable" : "configured but unreachable" };
      } catch (e) { return { name: "mail_relay", ok: false, detail: String(e).slice(0, 120) }; }
    })(),
    // The appliance boxes — live HTTP, not env presence.
    probeUrl("search_appliance", process.env.SOVEREIGN_SEARCH_URL),
    probeUrl("stt_appliance", process.env.SOVEREIGN_STT_URL),
    probeUrl("embed_appliance", process.env.SOVEREIGN_EMBED_URL),
  ]);
  return results;
}

async function readState(): Promise<WatchdogState | null> {
  try {
    const dl = await supabase.storage.from(STATE_BUCKET).download(STATE_PATH);
    if (dl.error || !dl.data) return null;
    return JSON.parse(await dl.data.text()) as WatchdogState;
  } catch { return null; }
}

async function writeState(state: WatchdogState): Promise<void> {
  await supabase.storage.createBucket(STATE_BUCKET, { public: false }).then(() => {}, () => {});
  await supabase.storage.from(STATE_BUCKET)
    .upload(STATE_PATH, new TextEncoder().encode(JSON.stringify(state)), { contentType: "application/json", upsert: true })
    .then(() => {}, () => {});
}

export interface Transition { name: string; kind: "went_down" | "recovered"; detail: string; downSince?: string }

/**
 * Pure transition logic — the part a test can hold still.
 * First run (no previous state): only failures alert (there is no transition to report for OK).
 */
export function computeTransitions(prev: WatchdogState | null, checks: CheckResult[], nowIso: string): { transitions: Transition[]; next: WatchdogState } {
  const transitions: Transition[] = [];
  const next: WatchdogState = { checks: {}, last_run: nowIso };
  for (const c of checks) {
    const before = prev?.checks?.[c.name];
    if (!before) {
      next.checks[c.name] = { ok: c.ok, since: nowIso };
      if (!c.ok) transitions.push({ name: c.name, kind: "went_down", detail: c.detail });
      continue;
    }
    if (before.ok === c.ok) {
      next.checks[c.name] = before;                        // state unchanged — `since` stands
    } else {
      next.checks[c.name] = { ok: c.ok, since: nowIso };
      transitions.push(c.ok
        ? { name: c.name, kind: "recovered", detail: c.detail, downSince: before.since }
        : { name: c.name, kind: "went_down", detail: c.detail });
    }
  }
  return { transitions, next };
}

function recipients(): { email: string }[] {
  const fromEnv = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map(s => s.trim()).filter(s => s.includes("@"));
  const list = fromEnv.length ? fromEnv : [...OWNER_EMAILS];
  return list.map(email => ({ email }));
}

export function alertEmail(transitions: Transition[], checks: CheckResult[], nowIso: string): { subject: string; body: string } {
  const down = transitions.filter(t => t.kind === "went_down");
  const up = transitions.filter(t => t.kind === "recovered");
  const subject = down.length
    ? `[Mondaily watchdog] ${down.map(t => t.name).join(", ")} DOWN`
    : `[Mondaily watchdog] ${up.map(t => t.name).join(", ")} recovered`;
  const mins = (since?: string) => since ? Math.max(1, Math.round((Date.parse(nowIso) - Date.parse(since)) / 60_000)) : null;
  const lines = transitions.map(t => t.kind === "went_down"
    ? `<li><b>${t.name}</b> is DOWN — ${t.detail}</li>`
    : `<li><b>${t.name}</b> recovered after ~${mins(t.downSince)} min — ${t.detail}</li>`).join("");
  const statusRows = checks.map(c => `<tr><td style="padding:2px 10px 2px 0;">${c.ok ? "&#9679;" : "&#9675;"} ${c.name}</td><td style="color:#6b7280;">${c.detail}</td></tr>`).join("");
  return {
    subject,
    body: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#111827;">
      <ul style="font-size:14px;">${lines}</ul>
      <p style="font-size:12px;color:#6b7280;margin:14px 0 4px;">Full sweep at ${nowIso.slice(0, 16).replace("T", " ")} UTC:</p>
      <table style="font-size:12px;border-collapse:collapse;">${statusRows}</table>
      <p style="font-size:11px;color:#9ca3af;margin-top:14px;">Sent by the in-app watchdog. Honest limit: it can see a degraded dependency, not its own total outage — if these emails STOP arriving while you expect them, check the platform itself.</p>
    </div>`,
  };
}

export async function runWatchdog(now: Date = new Date()): Promise<{ checks: CheckResult[]; transitions: Transition[]; alerted: boolean }> {
  const nowIso = now.toISOString();
  const checks = await runChecks();
  const prev = await readState();
  const { transitions, next } = computeTransitions(prev, checks, nowIso);
  let alerted = false;
  if (transitions.length) {
    const { subject, body } = alertEmail(transitions, checks, nowIso);
    // Alert BEFORE persisting: if the send fails, the transition stays pending and the next sweep
    // retries it — the wrong order records "already alerted" for an email nobody received.
    alerted = await sendPlatformEmail({ subject, body, to: recipients() }, { localPart: "watchdog", displayName: "Mondaily Watchdog" }).catch(() => false);
    if (!alerted) return { checks, transitions, alerted };
  }
  await writeState(next);
  return { checks, transitions, alerted };
}
