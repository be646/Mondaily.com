#!/usr/bin/env bash
# Mutation-test the design/behaviour guards.
#
# WHY THIS EXISTS: a source-scanning guard can pass over the exact bug it was written to catch. The
# column-header guard asserted `not.toMatch(/uppercase tracking-*/)` while the real markup carried
# `tracking-widest uppercase` — the same utilities, reversed — so it was green over a visibly wrong
# page. A green guard proves nothing until you have watched it go red.
#
# For each (fix commit, source file, guard file): restore the file to its PRE-FIX state, run the
# guard, and require it to FAIL. Then restore. Run after adding guards.
set -u
cd /Users/dannynicolaos/Documents/Codex/2026-05-27/doctype-html-html-lang-en-head
PAIRS="
b61f37d1|packages/api/src/lib/credits.ts|credit-ledger-aggregate
7b9e142d|packages/api/src/routes/onboarding.ts|entitlement-integrity
7b9e142d|packages/api/src/routes/invites.ts|entitlement-integrity
fa31f66e|apps/app/src/routes/dashboard/goals.tsx|silent-failure-guards
fa31f66e|apps/app/src/components/records/record-table.tsx|silent-failure-guards
fa31f66e|packages/api/src/routes/auth.ts|silent-failure-guards
9c13974a|packages/api/src/routes/reports.ts|silent-failure-guards
b44395f9|apps/app/src/components/records/record-detail.tsx|record-page-design
5a5f47c6|apps/app/src/components/ai/ai-intelligence.tsx|record-page-design
2c312722|apps/app/src/routes/dashboard/call-detail.tsx|record-page-design
"
echo "$PAIRS" | while IFS='|' read -r sha file test; do
  [ -z "${sha:-}" ] && continue
  git show "$sha^:$file" > /tmp/orig.tmp 2>/dev/null || { printf "  %-46s SKIP (no parent)\n" "$(basename $file)"; continue; }
  cp "$file" /tmp/cur.tmp
  cp /tmp/orig.tmp "$file"
  out=$(cd packages/api && npx vitest run "src/__tests__/$test.test.ts" 2>&1 | grep -oE '[0-9]+ failed' | head -1)
  cp /tmp/cur.tmp "$file"
  if [ -n "$out" ]; then printf "  ✓ CAUGHT   %-40s (%s)\n" "$(basename $file)" "$test"
  else printf "  ✗ MISSED   %-40s (%s)  <-- guard does not detect the reverted bug\n" "$(basename $file)" "$test"; fi
done
