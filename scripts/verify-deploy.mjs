#!/usr/bin/env node
/**
 * IS WHAT I JUST PUSHED ACTUALLY RUNNING?
 *
 * Written on 2026-08-13, after the API sat five commits and three hours behind production while
 * apps/app deployed normally every time. Nothing announced it. `git push` succeeded, tests passed,
 * the build was clean, and the fixes simply were not live — including the one that stopped an API
 * from emitting the shape that had just crashed /calendar. The gap was found by manually curling a
 * health endpoint on a hunch.
 *
 * The two Vercel projects deploy INDEPENDENTLY. One being live is not evidence about the other, and
 * the frontend is the one that usually works, so "I can see my change in the app" is exactly the
 * observation that hides a stalled API.
 *
 *   node scripts/verify-deploy.mjs            # compare both surfaces against HEAD
 *   node scripts/verify-deploy.mjs --watch    # keep checking until they match (or time out)
 *
 * Exits non-zero when a surface is behind, so it can gate a release step rather than being advice
 * somebody remembers to follow.
 */

import { execSync } from "node:child_process";

const API = process.env.MONDAILY_API_URL ?? "https://api.mondaily.com";
const APP = process.env.MONDAILY_APP_URL ?? "https://app.mondaily.com";
const watch = process.argv.includes("--watch");
const DEADLINE_MS = 15 * 60_000;
const POLL_MS = 30_000;

const head = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const shortHead = head.slice(0, 8);

/** The API states its commit outright — the only surface here that can be checked exactly. */
async function apiCommit() {
  try {
    const res = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return { ok: true, commit: String(body.commit ?? ""), version: body.version };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The frontend exposes no SHA, so it is checked by asset identity instead: the bundle filename is a
 * content hash, so a changed filename proves a rebuild shipped. That cannot prove WHICH commit — it
 * is a liveness signal, not an equality check, and is reported as such rather than dressed up.
 */
async function appBundle() {
  try {
    const res = await fetch(APP, { signal: AbortSignal.timeout(20_000) });
    const html = await res.text();
    const m = html.match(/assets\/index-([A-Za-z0-9._-]+)\.js/);
    return { ok: res.ok, asset: m?.[1] ?? null };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function report() {
  const [api, app] = await Promise.all([apiCommit(), appBundle()]);
  const apiMatches = api.ok && api.commit === head;

  console.log(`HEAD            ${shortHead}`);
  console.log(`api.mondaily    ${api.ok ? api.commit.slice(0, 8) : `UNREACHABLE (${api.detail})`}` +
    (api.ok ? (apiMatches ? "  ✓ live" : "  ✗ BEHIND") : ""));
  console.log(`app.mondaily    ${app.ok ? `bundle index-${app.asset}.js` : `UNREACHABLE (${app.detail})`}`);

  if (api.ok && !apiMatches) {
    let behind = "unknown";
    try {
      behind = execSync(`git rev-list --count ${api.commit}..HEAD`, { encoding: "utf8" }).trim();
    } catch { /* the deployed commit may not exist locally */ }
    console.log(`\nThe API is ${behind} commit(s) behind. Nothing you have pushed to packages/api is`);
    console.log(`running. Check the mondaily-api project's Deployments tab — either the newest build`);
    console.log(`failed, or the git integration is disconnected. A clean local build does NOT rule`);
    console.log(`this out: tsup and tsc both passed while production stayed three hours stale.`);
  }
  return apiMatches;
}

if (!watch) {
  process.exit((await report()) ? 0 : 1);
}

const until = Date.now() + DEADLINE_MS;
for (;;) {
  if (await report()) { console.log("\nboth surfaces are current."); process.exit(0); }
  if (Date.now() > until) {
    console.error(`\nStill behind after ${DEADLINE_MS / 60_000} minutes. This is not slowness — treat it as a failed deploy.`);
    process.exit(1);
  }
  console.log(`\n…rechecking in ${POLL_MS / 1000}s\n`);
  await new Promise(r => setTimeout(r, POLL_MS));
}
