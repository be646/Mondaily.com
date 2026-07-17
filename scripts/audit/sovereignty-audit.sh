#!/usr/bin/env bash
# Sovereignty-readiness audit for Mondaily. Static scans that back the claim:
# "sovereign AI, sovereign search, native auth, isolated workspace data, source-backed agents."
# Run from repo root:  bash scripts/audit/sovereignty-audit.sh
# Exit code is non-zero if any HARD check fails (provider leak, gateway not fail-closed, search not fail-closed).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
API=packages/api/src
WEB=apps/web
APP=apps/app/src
fail=0
sec() { printf "\n\033[1m%s\033[0m\n" "$1"; }
ok()  { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad() { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=1; }
warn(){ printf "  \033[33m!\033[0m %s\n" "$1"; }

# ── 1. PROVIDER LEAK SCAN ─────────────────────────────────────────────────────
sec "1. Provider leak scan (Clerk / OpenAI / Anthropic / Tavily)"
# Scan RUNTIME code only. Test files legitimately name provider hosts as DENYLIST fixtures/assertions
# (e.g. sovereignty.test.ts lists api.tavily.com to assert it's absent from runtime) — excluding them
# keeps the scan meaningful (all runtime dirs still covered) without flagging the assertions themselves.
LEAK=$(grep -rInE "from ['\"](@clerk|@anthropic|@anthropic-ai/sdk)|api\.openai\.com|api\.anthropic\.com|api\.tavily\.com|clerkClient|ClerkProvider|new Anthropic|process\.env\.(CLERK|OPENAI|ANTHROPIC|TAVILY)[A-Z_]*" \
  "$API" "$APP" "$WEB/app" "$WEB/components" --include="*.ts" --include="*.tsx" \
  --exclude-dir=__tests__ --exclude="*.test.ts" --exclude="*.test.tsx" 2>/dev/null | grep -vE ":\s*(//|\*)")
if [ -z "$LEAK" ]; then ok "no active Clerk/Anthropic/Tavily/direct-OpenAI code paths"; else bad "provider references found:"; echo "$LEAK" | sed 's/^/      /'; fi
# The openai SDK is allowed ONLY as an openai-compatible client with an explicit baseURL (the sovereign
# gateway). Check a 3-line window so multi-line `new OpenAI({ \n baseURL, ... })` isn't a false positive.
BAREOPENAI=$(for f in $(grep -rIlE "new OpenAI\(" "$API" --include="*.ts"); do
  awk -v F="$f" '{L[NR]=$0} /new OpenAI\(/{S[NR]=1} END{for(n in S){b=0;for(i=n;i<=n+3;i++)if(L[i]~/baseURL/)b=1; if(!b)print F":"n": "L[n]}}' "$f"
done)
if [ -z "$BAREOPENAI" ]; then ok "every 'new OpenAI(...)' is baseURL-gated (openai-compat to the sovereign gateway)"; else bad "OpenAI client without baseURL (would hit api.openai.com):"; echo "$BAREOPENAI" | sed 's/^/      /'; fi

# ── 2. MARKETING WEB SECRET SCAN ──────────────────────────────────────────────
sec "2. Marketing web uses only NEXT_PUBLIC_API_URL (no AI secrets)"
WEBSECRETS=$(grep -rInE "process\.env\.(AI_GATEWAY|CEREBRAS|SOVEREIGN|OPENAI|ANTHROPIC|CLERK|STRIPE_SECRET|SUPABASE_SERVICE)" "$WEB" --include="*.ts" --include="*.tsx" 2>/dev/null | grep -vE ":\s*(//|\*)")
if [ -z "$WEBSECRETS" ]; then ok "no server AI/DB secrets read in apps/web"; else bad "secret env read in marketing web:"; echo "$WEBSECRETS" | sed 's/^/      /'; fi

# ── 3. AI GATEWAY FAIL-CLOSED CHECK ───────────────────────────────────────────
sec "3. AI gateway fails closed when env missing"
if grep -q "refusing to route inference to a default OpenAI endpoint" "$API/lib/ai-gateway.ts" \
   && grep -qE "if \(!baseURL\)" "$API/lib/ai-gateway.ts"; then ok "gateway throws if AI_GATEWAY_BASE_URL/API_KEY missing"; else bad "gateway fail-closed guard not found"; fi

# ── 4. SEARCH FAIL-CLOSED / SOVEREIGN-ONLY CHECK ──────────────────────────────
sec "4. Search routes only via SOVEREIGN_SEARCH_URL (no third-party search)"
if grep -q "SOVEREIGN_SEARCH_URL" "$API/lib/sovereign-search.ts" && grep -q "SOVEREIGN_SEARCH_URL" "$API/jobs/social-discovery.ts"; then ok "search paths read SOVEREIGN_SEARCH_URL"; else bad "sovereign search env not referenced in search paths"; fi
THIRDPARTYSEARCH=$(grep -rInE "serpapi|api\.tavily|bing\.microsoft|googleapis\.com/customsearch|scrapfly|scraperapi|firecrawl" "$API" --include="*.ts" --exclude-dir=__tests__ --exclude="*.test.ts" | grep -vE ":\s*(//|\*)")
if [ -z "$THIRDPARTYSEARCH" ]; then ok "no third-party search/scrape SaaS in the API"; else warn "third-party search/scrape references (review):"; echo "$THIRDPARTYSEARCH" | sed 's/^/      /'; fi

# ── 5. WORKSPACE ISOLATION HEURISTIC ──────────────────────────────────────────
sec "5. Workspace isolation — Supabase reads/writes without workspace_id (heuristic)"
# Tables that are legitimately NOT workspace-scoped (global/auth/config).
GLOBAL='workspaces|users|user_|auth_|sessions|ai_credits|invites|workspace_members|email_connections|discovery_cache|pow_|refresh'
SUSPECT=$(grep -rInE '\.from\("' "$API/routes" "$API/jobs" --include="*.ts" \
  | grep -vE ":\s*(//|\*)" \
  | grep -viE "$GLOBAL")
# For each suspect line's file, we can't perfectly prove scoping statically; count and list files to review.
COUNT=$(printf "%s\n" "$SUSPECT" | grep -c '\.from(' 2>/dev/null || echo 0)
printf "  %s workspace-table query sites to eyeball (see workspace-isolation-scan output).\n" "$COUNT"
warn "heuristic only — run 'node scripts/audit/workspace-isolation-scan.mjs' for per-query workspace_id proximity"

# ── 6b. SOURCE-BACKED-ANSWER ENFORCEMENT (grounded endpoints have an insufficient-data path) ──
sec "6b. Source-backed answer enforcement"
GROUNDED=0
grep -q "don't have enough tracked activity" "$API/routes/activities.ts" && GROUNDED=$((GROUNDED+1)) && ok "member-insight returns 'insufficient activity' when data is thin (no fabrication)"
grep -q "no on-topic results found\|No on-topic" "$API/jobs/social-discovery.ts" && GROUNDED=$((GROUNDED+1)) && ok "discovery overview is built only from extracted rows (grounded)"
grep -q "source-backed\|Never invent\|never invent\|ONLY on the page\|grounded" "$API/jobs/social-discovery.ts" && ok "extraction system prompt forbids inventing data"
[ $GROUNDED -ge 1 ] || warn "no insufficient-data guard found in the grounded endpoints — review AI answer surfaces"

# ── 7. TRAINING GOVERNANCE (opt-in + redaction + workspace-isolated) ──────────
sec "7. Training-data governance"
grep -q "OPT-IN gate" "$API/lib/training-ledger.ts" && ok "training capture is opt-in (off by default)" || bad "training capture is not opt-in gated"
grep -q "redactPII" "$API/lib/training-ledger.ts" && ok "training prompts run through redactPII" || bad "training capture does not redact PII"
[ -f "$API/routes/training.ts" ] && ok "visible controls: /training policy/export/purge exist" || warn "no /training controls route"

# ── 8. STALE WORDING SCAN ─────────────────────────────────────────────────────
sec "8. Stale wording scan (Mondaily CRM / CRM records / active legacy providers)"
STALE=$(grep -rInE "Mondaily CRM|CRM records|CRM: (Lead|Enrich|Deal)|our CRM|the CRM\b|Nylas (is|handles|powers)|powered by (OpenAI|Anthropic|Tavily|Clerk)|Tavily (search|is used)" \
  "$API" "$APP" "$WEB/app" "$WEB/components" packages/prompts 2>/dev/null | grep -vE ":\s*(//|\*)|LEGACY|DISABLED|removed")
if [ -z "$STALE" ]; then ok "no stale 'Mondaily CRM' / 'CRM records' / active-legacy-provider wording"; else bad "stale wording found:"; echo "$STALE" | sed 's/^/      /'; fi

# ── 9. PUBLIC ROUTE JUSTIFICATION SCAN ────────────────────────────────────────
sec "9. Public route justification (routes without requireAuth must be explicitly justified)"
# Allow-list of routers that are intentionally public, each with a reason.
# health/status(auth'd separately), auth, webhooks(sig-validated), public ask, oauth callbacks, mcp(own key), inngest(sig).
ALLOWED='auth|public-ask|webhooks|status|health|onboarding|integrations|mcp|realtime'
for f in $(ls "$API/routes"/*.ts); do
  base=$(basename "$f" .ts)
  if grep -qE "requireAuth|requireJwt|requireAdmin|requirePlatformAdmin" "$f"; then continue; fi
  if echo "$base" | grep -qE "^($ALLOWED)$"; then ok "public (justified): $base"; else bad "route '$base' has no auth middleware and is not in the justified public allow-list"; fi
done

# ── 10. ENV DEPENDENCY SCAN ───────────────────────────────────────────────────
sec "10. Env dependency scan (what the API reads)"
grep -rhoE "process\.env\.[A-Z0-9_]+" "$API" --include="*.ts" | sed 's/process.env.//' | sort -u | tr '\n' ' '
echo ""

printf "\n\033[1mResult:\033[0m %s\n" "$([ $fail -eq 0 ] && echo '✓ hard checks passed' || echo '✗ hard checks FAILED — see ✗ above')"
exit $fail
