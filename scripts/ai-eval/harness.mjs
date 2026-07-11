#!/usr/bin/env node
/**
 * Mondaily AI Eval Harness — OFFLINE, Phase 3A.1.
 *
 * Replays docs/ai-eval fixtures against two OpenAI-compatible endpoints (hosted baseline + private
 * candidate) and writes a JSON + Markdown report. This is a standalone validation tool:
 *
 *   - It imports NOTHING from @mondaily/* / app runtime, and is imported by nothing in the app.
 *   - It NEVER runs in production (refuses if VERCEL or NODE_ENV=production).
 *   - Offline mode FAILS CLOSED without all required env vars.
 *   - It touches NO production table and NO AI_GATEWAY_* / AI_MODEL_* env used by the live app.
 *   - It accepts only source:"synthetic" fixtures for now.
 *
 * Node standard library only (global fetch). No dependencies.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const FIXTURE_DIR = join(REPO, "docs", "ai-eval", "fixtures");
const SCHEMA_PATH = join(FIXTURE_DIR, "_schema.json");

// ── arg parsing ────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const a = { dryRun: false, offline: false, class: null, out: null };
  for (const t of argv) {
    if (t === "--dry-run") a.dryRun = true;
    else if (t === "--offline") a.offline = true;
    else if (t.startsWith("--class=")) a.class = t.slice("--class=".length);
    else if (t.startsWith("--out=")) a.out = t.slice("--out=".length);
  }
  return a;
}

// ── fixture loading + validation (mirrors docs/ai-eval/fixtures/_schema.json) ─
const METRICS = new Set(["grounding", "json_validity", "refusal", "latency", "tokens", "cache"]);
const CLASSES = new Set(["fast", "support", "reasoning", "meeting", "extraction", "discovery", "summarization"]);
const REQUIRED = ["id", "class", "prompt", "metrics", "source"];
const ALLOWED = new Set(["id", "class", "prompt", "context", "params", "must_refuse", "expected", "metrics", "source"]);

export function validateFixture(o) {
  const errs = [];
  for (const k of REQUIRED) if (!(k in o)) errs.push(`missing ${k}`);
  for (const k of Object.keys(o)) if (!k.startsWith("__") && !ALLOWED.has(k)) errs.push(`unknown key ${k}`);
  if (o.class && !CLASSES.has(o.class)) errs.push(`bad class ${o.class}`);
  if (o.metrics && (!Array.isArray(o.metrics) || o.metrics.some((m) => !METRICS.has(m)))) errs.push(`bad metrics`);
  if (o.source && o.source !== "synthetic" && o.source !== "sanitized-real") errs.push(`bad source`);
  // Phase 3A.1: only synthetic fixtures are permitted to run.
  if (o.source !== "synthetic") errs.push(`source must be "synthetic" for now (got ${JSON.stringify(o.source)})`);
  return errs;
}

export function loadFixtures(filterClass) {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".jsonl"));
  const items = [];
  for (const f of files) {
    const cls = f.replace(/\.jsonl$/, "");
    if (filterClass && cls !== filterClass) continue;
    const lines = readFileSync(join(FIXTURE_DIR, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      const s = line.trim();
      if (!s) return;
      let o;
      try { o = JSON.parse(s); } catch (e) { items.push({ __parseError: `${f}:${i + 1} ${e.message}` }); return; }
      o.__file = f; o.__line = i + 1;
      items.push(o);
    });
  }
  return items;
}

// ── lightweight output-schema check for extraction/discovery ─────────────────
function checkJsonOutput(text, schema) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { parsed: false, conformant: false }; }
  if (!schema) return { parsed: true, conformant: true };
  const req = schema.required || [];
  const conformant = req.every((k) => k in parsed);
  return { parsed: true, conformant };
}

// heuristic refusal detector (placeholder; real scoring is rubric/human in the report)
const REFUSAL_RE = /\b(can'?t|cannot|unable to|don'?t have|not able|no information|couldn'?t find|i'?m sorry|i am sorry|not something i can)\b/i;
function looksRefused(text) {
  const t = (text || "").trim();
  return t.length === 0 || REFUSAL_RE.test(t);
}

// ── OpenAI-compatible call ───────────────────────────────────────────────────
async function callEndpoint({ baseURL, apiKey, model }, fixture) {
  const messages = [];
  if (fixture.context) messages.push({ role: "system", content: `Reference context:\n${fixture.context}` });
  messages.push({ role: "user", content: fixture.prompt });
  const body = { model, messages, temperature: fixture.params?.temperature ?? 0, max_tokens: fixture.params?.max_tokens ?? 512 };
  const t0 = Date.now();
  const res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const latency_ms = Date.now() - t0;
  if (!res.ok) return { ok: false, latency_ms, error: `HTTP ${res.status}` };
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
  const usage = json.usage ?? {};
  return {
    ok: true,
    latency_ms,
    text,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    // vLLM prefix-cache field when --enable-prefix-caching is on:
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? null,
  };
}

// ── scoring per fixture+endpoint ─────────────────────────────────────────────
function score(fixture, resp) {
  const m = new Set(fixture.metrics);
  const out = { latency_ms: resp.latency_ms ?? null };
  if (!resp.ok) return { ...out, error: resp.error };
  if (m.has("tokens")) { out.prompt_tokens = resp.prompt_tokens; out.completion_tokens = resp.completion_tokens; }
  if (m.has("cache")) out.cached_tokens = resp.cached_tokens; // null if endpoint doesn't report it
  if (m.has("json_validity")) {
    const { parsed, conformant } = checkJsonOutput(resp.text, fixture.expected?.schema);
    out.json_parsed = parsed; out.json_conformant = conformant;
  }
  if (m.has("refusal")) {
    const refused = looksRefused(resp.text);
    out.refused = refused;
    out.refusal_correct = refused === Boolean(fixture.must_refuse);
  }
  if (m.has("grounding")) out.grounding = null; // PLACEHOLDER — rubric/human or LLM-judge, filled later
  return out;
}

// ── guards ───────────────────────────────────────────────────────────────────
export function assertNotProduction(env) {
  if (env.VERCEL || env.NODE_ENV === "production") {
    throw new Error("[eval] refusing to run in a production environment (VERCEL / NODE_ENV=production set).");
  }
}
const REQUIRED_ENV = ["EVAL_HOSTED_BASE_URL", "EVAL_HOSTED_API_KEY", "EVAL_HOSTED_MODEL", "EVAL_PRIVATE_BASE_URL", "EVAL_PRIVATE_API_KEY", "EVAL_PRIVATE_MODEL"];
export function resolveEndpoints(env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k] || !String(env[k]).trim());
  if (missing.length) {
    throw new Error(`[eval] offline mode requires local env vars — missing: ${missing.join(", ")}. Fails closed by design.`);
  }
  return {
    hosted: { baseURL: env.EVAL_HOSTED_BASE_URL, apiKey: env.EVAL_HOSTED_API_KEY, model: env.EVAL_HOSTED_MODEL },
    private: { baseURL: env.EVAL_PRIVATE_BASE_URL, apiKey: env.EVAL_PRIVATE_API_KEY, model: env.EVAL_PRIVATE_MODEL },
  };
}

// ── report rendering ─────────────────────────────────────────────────────────
function toMarkdown(report) {
  const L = [];
  L.push(`# AI Eval Report — ${report.mode}`, "", `Generated: ${report.generated_at}`, `Fixtures: ${report.fixture_count} · Classes: ${report.classes.join(", ")}`, "");
  if (report.mode === "dry-run") {
    L.push(`Validation: **${report.invalid === 0 ? "PASS" : "FAIL"}** (${report.invalid} invalid).`, "");
    return L.join("\n");
  }
  L.push(`Endpoints: hosted=\`${report.endpoints.hosted.model}\` · private=\`${report.endpoints.private.model}\` (URLs/keys not logged)`, "");
  L.push("| id | class | side | lat ms | prompt tok | compl tok | cached | json | refusal✓ |", "|---|---|---|---|---|---|---|---|---|");
  for (const r of report.results) {
    for (const side of ["hosted", "private"]) {
      const s = r[side] || {};
      L.push(`| ${r.id} | ${r.class} | ${side} | ${s.latency_ms ?? "-"} | ${s.prompt_tokens ?? "-"} | ${s.completion_tokens ?? "-"} | ${s.cached_tokens ?? "-"} | ${s.json_parsed === undefined ? "-" : `${s.json_parsed && s.json_conformant}`} | ${s.refusal_correct === undefined ? "-" : s.refusal_correct} |`);
    }
  }
  L.push("", "> Source-grounding scores are placeholders (null) — filled by rubric/human or LLM-judge, see RUBRICS.md.");
  return L.join("\n");
}

// ── main ─────────────────────────────────────────────────────────────────────
export async function run(argv = process.argv.slice(2), env = process.env, now = () => new Date()) {
  const args = parseArgs(argv);
  const mode = args.dryRun || !args.offline ? "dry-run" : "offline";
  const fixtures = loadFixtures(args.class);

  // Validate every fixture regardless of mode.
  const parseErrors = fixtures.filter((f) => f.__parseError).map((f) => f.__parseError);
  const valid = fixtures.filter((f) => !f.__parseError);
  const invalidList = [];
  for (const f of valid) { const errs = validateFixture(f); if (errs.length) invalidList.push(`${f.__file}:${f.__line} ${errs.join("; ")}`); }
  const invalid = parseErrors.length + invalidList.length;

  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const classes = [...new Set(valid.map((f) => f.class))].sort();

  if (mode === "dry-run") {
    const report = { generated_at: now().toISOString(), mode, fixture_count: valid.length, classes, invalid, parseErrors, invalidList };
    if (invalid) { console.error(`[eval] dry-run FAIL — ${invalid} invalid fixtures:`); [...parseErrors, ...invalidList].forEach((e) => console.error("  - " + e)); }
    else console.log(`[eval] dry-run PASS — ${valid.length} fixtures across ${classes.length} classes valid.`);
    return { report, exitCode: invalid ? 1 : 0 };
  }

  // OFFLINE MODE — guards first (fail closed).
  assertNotProduction(env);
  if (invalid) throw new Error(`[eval] refusing offline run — ${invalid} invalid fixtures. Fix fixtures first.`);
  const endpoints = resolveEndpoints(env);

  const results = [];
  for (const f of valid) {
    const [hosted, priv] = await Promise.all([
      callEndpoint(endpoints.hosted, f).catch((e) => ({ ok: false, error: String(e) })),
      callEndpoint(endpoints.private, f).catch((e) => ({ ok: false, error: String(e) })),
    ]);
    results.push({ id: f.id, class: f.class, hosted: score(f, hosted), private: score(f, priv) });
  }

  const report = {
    generated_at: now().toISOString(), mode, fixture_count: valid.length, classes,
    endpoints: { hosted: { model: endpoints.hosted.model }, private: { model: endpoints.private.model } }, // no urls/keys
    results,
  };
  const outDir = args.out || join(HERE, "runs", stamp);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "report.md"), toMarkdown(report));
  console.log(`[eval] offline run complete — ${results.length} fixtures. Report: ${outDir}`);
  return { report, exitCode: 0, outDir };
}

// Only execute when invoked directly (never on import).
const INVOKED_DIRECTLY = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED_DIRECTLY) {
  run().then(({ exitCode }) => process.exit(exitCode)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
