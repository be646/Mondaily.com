#!/usr/bin/env node
/**
 * Live sovereignty-readiness smoke test — hits the DEPLOYED API and prints pass/fail for every
 * pillar in one shot. Read-only; makes no changes. Dependency-free (Node 18+ global fetch).
 *
 * Usage:
 *   MONDAILY_API=https://api.mondaily.com \
 *   MONDAILY_COOKIE='md_at=<paste from browser devtools → Application → Cookies>' \
 *   MONDAILY_WORKSPACE='<your workspace uuid>' \
 *   node scripts/audit/live-readiness.mjs
 *
 *   # or via pnpm:  MONDAILY_COOKIE='md_at=…' MONDAILY_WORKSPACE='workspace_uuid' pnpm readiness:live
 *
 * Env:
 *   MONDAILY_API       API base URL (default https://api.mondaily.com)
 *   MONDAILY_COOKIE    full Cookie header, or just the `md_at=…` value — needed for the authed
 *                      /status + /training probes. Copy it from your logged-in browser session.
 *   MONDAILY_WORKSPACE your workspace uuid — sent as the X-Workspace-Id header that every authed
 *                      route requires. Without it the authed probes return 400. Find it in the app
 *                      URL or devtools (the X-Workspace-Id request header on any API call).
 *   MONDAILY_TOKEN     alternative to the cookie: a bearer token (sent as Authorization: Bearer …)
 *
 * Exit code: 0 if no CORE pillar is in error/needs_setup, else 1 (CI-friendly).
 * Optional connectors (Google/Microsoft/Stripe/LiveKit) never fail the run — they're reported
 * as info only, matching how /status treats them.
 */

const API = (process.env.MONDAILY_API || "https://api.mondaily.com").replace(/\/+$/, "");
const COOKIE = process.env.MONDAILY_COOKIE || "";
const TOKEN = process.env.MONDAILY_TOKEN || "";
const WORKSPACE = process.env.MONDAILY_WORKSPACE || "";

// ANSI (skipped if not a TTY / NO_COLOR set)
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c("32", s), red = (s) => c("31", s), yellow = (s) => c("33", s), dim = (s) => c("90", s), bold = (s) => c("1", s);
const ICON = { pass: green("✓"), fail: red("✗"), warn: yellow("!"), info: dim("·") };

// Optional-connector check ids — reported but never fail the run.
const OPTIONAL = new Set(["email", "microsoft", "stripe", "calls", "cron_secret", "sovereign_search_key"]);

let coreFail = 0;
const authHeaders = () => {
  const h = { Accept: "application/json" };
  if (COOKIE) h.Cookie = COOKIE.includes("=") ? COOKIE : `md_at=${COOKIE}`;
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  // Every authed route requires the workspace context header, or it 400s before auth even runs.
  if (WORKSPACE) h["X-Workspace-Id"] = WORKSPACE;
  return h;
};

async function get(path, { auth = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(`${API}${path}`, { headers: auth ? authHeaders() : { Accept: "application/json" }, signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.message || e) };
  } finally { clearTimeout(t); }
}

function line(icon, label, detail) {
  console.log(`  ${icon} ${label}${detail ? dim(" — " + detail) : ""}`);
}

async function main() {
  console.log(bold(`\nMondaily live readiness · ${API}\n`));

  // ── Public: API health ──────────────────────────────────────────────────────
  console.log(bold("Public"));
  const health = await get("/api/health");
  if (health.status === 200 && health.json?.ok) line(ICON.pass, "API health", `v${health.json.version ?? "?"}`);
  else { line(ICON.fail, "API health", `status ${health.status}`); coreFail++; }

  // ── Public: AI gateway health (fails closed if AI_GATEWAY_* missing) ─────────
  const gw = await get("/api/v1/ask/health");
  if (gw.status === 200 && gw.json?.ok) line(ICON.pass, "AI gateway", gw.json?.model ? `model ${gw.json.model}` : "reachable");
  else { line(ICON.fail, "AI gateway", gw.json?.reason || gw.json?.error || `status ${gw.status} (503 = AI_GATEWAY_* not set)`); coreFail++; }

  // ── Authed: full /status pillar readiness (server runs live search/scraper probes) ──
  if (!COOKIE && !TOKEN) {
    console.log(yellow("\n! No MONDAILY_COOKIE / MONDAILY_TOKEN set — skipping authed /status + /training probes."));
    console.log(dim("  Copy the `md_at` cookie from your logged-in browser (devtools → Application → Cookies) and re-run.\n"));
  } else if (!WORKSPACE) {
    console.log(yellow("\n! MONDAILY_WORKSPACE not set — authed routes require the X-Workspace-Id header and will 400 without it."));
    console.log(dim("  Set MONDAILY_WORKSPACE to your workspace uuid (from the app URL or the X-Workspace-Id request header) and re-run.\n"));
  } else {
    console.log(bold("\nWorkspace readiness (/status)"));
    const st = await get("/api/v1/status", { auth: true });
    if (st.status === 401) {
      console.log(red("  ✗ Unauthorized — the cookie/token is missing or expired. Grab a fresh md_at cookie."));
      coreFail++;
    } else if (st.status !== 200 || !Array.isArray(st.json?.checks)) {
      console.log(red(`  ✗ /status returned ${st.status}: ${st.text.slice(0, 160)}`));
      coreFail++;
    } else {
      for (const chk of st.json.checks) {
        const optional = OPTIONAL.has(chk.id);
        let icon = ICON.info, mark = false;
        if (chk.state === "operational") icon = ICON.pass;
        else if (chk.state === "disabled" || chk.state === "not_checked") icon = ICON.info;
        else { icon = optional ? ICON.warn : ICON.fail; mark = !optional; }
        if (mark) coreFail++;
        line(icon, `${chk.label}${optional ? dim(" (optional)") : ""}`, chk.state !== "operational" ? chk.state : "");
        if (chk.state !== "operational" && chk.action) console.log(dim(`      Do this: ${chk.action}`));
      }
      // Migrations
      const notApplied = (st.json.migrations ?? []).filter((m) => !m.applied);
      if (notApplied.length === 0) line(ICON.pass, "Migrations", `${(st.json.migrations ?? []).length} applied`);
      else { line(ICON.fail, "Migrations", `${notApplied.length} NOT applied: ${notApplied.map((m) => m.id).join(", ")}`); coreFail++; }
    }

    // ── Authed: training controls reachable + opt-in state ───────────────────
    console.log(bold("\nTraining controls (/training)"));
    const tp = await get("/api/v1/training/policy", { auth: true });
    if (tp.status === 200 && tp.json) {
      line(ICON.pass, "Training policy endpoint", `capture ${tp.json.enabled ? "ENABLED" : "OFF (default)"} · ${tp.json.captured ?? 0} captured · retention ${tp.json.retention_days}d`);
    } else if (tp.status === 401) {
      line(ICON.fail, "Training policy endpoint", "unauthorized"); coreFail++;
    } else {
      line(ICON.warn, "Training policy endpoint", `status ${tp.status} (needs ai_training_logs migration?)`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("");
  if (coreFail === 0) { console.log(green(bold("✓ All core pillars operational."))); process.exit(0); }
  else { console.log(red(bold(`✗ ${coreFail} core pillar(s) need attention (optional connectors don't count).`))); process.exit(1); }
}

main().catch((e) => { console.error(red("readiness probe crashed:"), e); process.exit(2); });
