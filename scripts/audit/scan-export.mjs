#!/usr/bin/env node
/**
 * Scan a downloaded Training Data export for RAW PII/secrets that should have been redacted.
 * Read-only. Deep-walks every row (including nested model_output / edited_output / evidence /
 * candidate / contact / recommended_action) and flags any string that still contains a real
 * email, phone, API key, bearer token, JWT, card-like number, or SSN.
 *
 * Usage:
 *   node scripts/audit/scan-export.mjs ~/Downloads/mondaily-training-export-2026-07-03.json
 *
 * Exit code 0 = clean (safe to keep), 1 = leaks found, 2 = bad input.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/audit/scan-export.mjs <export.json>"); process.exit(2); }

let doc;
try { doc = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.error(`Could not read/parse ${file}: ${e.message}`); process.exit(2); }

const rows = Array.isArray(doc) ? doc : (doc.rows ?? []);
if (!Array.isArray(rows)) { console.error("No `rows` array found in the export."); process.exit(2); }

// Raw-secret detectors (mirror the redactor's own patterns). A match on any of these in the
// EXPORTED file means the sanitizer missed it. `created_at` is excluded (a real ISO date can look
// like a phone number and is intentionally left un-redacted as a timestamp field).
const DETECTORS = [
  ["email",        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ["ssn",          /\b\d{3}-\d{2}-\d{4}\b/],
  ["card",         /\b(?:\d[ -]?){13,16}\b/],
  ["jwt",          /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["bearer",       /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i],
  ["api_key",      /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b|\bAKIA[0-9A-Z]{16}\b/],
  ["phone",        /\b\+?\d[\d ()-]{8,}\d\b/],
];
// A string that is purely an ISO-8601 date/time is NOT a phone leak — skip those.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/;

const leaks = [];
const mask = (s) => s.length <= 6 ? "***" : `${s.slice(0, 3)}…${s.slice(-2)}`;

function walk(value, path) {
  if (typeof value === "string") {
    if (ISO_DATE.test(value.trim())) return;
    for (const [kind, re] of DETECTORS) {
      // phone detector: ignore matches that are actually a date fragment already handled above
      const m = value.match(re);
      if (m) leaks.push({ path, kind, sample: mask(m[0]) });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  }
}

let placeholderHits = 0;
const PLACEHOLDER = /\[REDACTED_(EMAIL|PHONE|KEY|JWT|CARD|SSN|AWS_KEY|TOKEN|DEPTH_LIMIT)\]|\[NEUTRALIZED_INSTRUCTION:/;

for (let i = 0; i < rows.length; i++) {
  const { created_at, ...scanScope } = rows[i]; // created_at is a real timestamp, not PII
  void created_at;
  walk(scanScope, `row[${i}]`);
  if (PLACEHOLDER.test(JSON.stringify(rows[i]))) placeholderHits++;
}

// Which coverage fields exist in the corpus (so we can say we actually looked at them).
const fieldsSeen = new Set();
for (const r of rows) {
  for (const f of ["model_output", "edited_output"]) if (r[f] != null) fieldsSeen.add(f);
  const blob = JSON.stringify(r);
  for (const nested of ["evidence", "candidate", "contact", "recommended_action"]) if (blob.includes(`"${nested}"`)) fieldsSeen.add(nested);
}

console.log(`\nScanned ${rows.length} row(s) from ${file}`);
console.log(`Nested fields present in corpus: ${[...fieldsSeen].join(", ") || "(none)"}`);
console.log(`Rows showing redaction placeholders: ${placeholderHits}/${rows.length}`);

if (leaks.length === 0) {
  console.log(`\n✓ CLEAN — no raw emails, phones, keys, tokens, JWTs, cards, or SSNs found. Safe to keep/use.\n`);
  process.exit(0);
}

// Group leaks by kind for a readable summary.
const byKind = {};
for (const l of leaks) (byKind[l.kind] ??= []).push(l);
console.log(`\n✗ ${leaks.length} POTENTIAL LEAK(S) FOUND:`);
for (const [kind, list] of Object.entries(byKind)) {
  console.log(`  ${kind}: ${list.length}`);
  for (const l of list.slice(0, 5)) console.log(`     ${l.path}  (${l.sample})`);
  if (list.length > 5) console.log(`     … +${list.length - 5} more`);
}
console.log(`\nDo NOT use this export. Re-report so the redactor can be fixed.\n`);
process.exit(1);
