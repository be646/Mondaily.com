# Mondaily Sovereignty

The claim Mondaily makes:

> AI-native autonomous workspace with **sovereign AI, sovereign search, native auth,
> isolated workspace data, source-backed agents, and customer-controlled training data.**

This document maps that claim to what is enforced in code today, what is
"sovereign-compatible" (correct architecture, depends on where you deploy it),
and the exact path to true 100% sovereignty. It does not pretend anything is
done that isn't — `/api/v1/status` reports the live truth per environment.

## Core vs. optional

- **Core sovereign infrastructure** — AI gateway, search + scraper, native auth,
  workspace-isolated database, background jobs. These route only through
  endpoints you control and **fail closed** when unset (no third-party fallback).
- **Optional customer-authorized connectors** — Stripe, Google, Microsoft,
  email/calendar, LiveKit, Reddit, Google Places. Each is inert until a customer
  connects it, is never described as core AI infrastructure, and is surfaced
  honestly in `/status`. They are allowed and do **not** weaken the core claim.

## Enforced in code today

| Pillar | Enforcement |
|---|---|
| Sovereign AI | `lib/ai-gateway.ts` throws if `AI_GATEWAY_BASE_URL`/`AI_GATEWAY_API_KEY` missing. No default OpenAI endpoint; no provider-specific fallback. OpenAI SDK used only as an openai-compatible client with an explicit `baseURL`. |
| Sovereign search | `lib/sovereign-search.ts` + `jobs/social-discovery.ts` route only through `SOVEREIGN_SEARCH_URL`/`SOVEREIGN_SCRAPE_URL`. In production, missing env returns a clear setup error — no localhost fallback, no third-party search SaaS. |
| Native auth | Sovereign email/password + signed cookie sessions (`AUTH_JWT_SECRET`). Clerk fully removed. |
| Workspace isolation | Every workspace query scopes by `workspace_id` or a preceding workspace-scoped ownership fetch. Backstop: RLS policies. Scanner: `scripts/audit/workspace-isolation-scan.mjs`. |
| Source-backed agents | Discovery saves only extracted, source-backed rows; overview is built from extracted rows; extraction prompt forbids inventing data. Grounded endpoints return an honest "insufficient data" instead of fabricating. |
| Customer-controlled training | Capture is **opt-in, default OFF**, per workspace. PII/secrets redacted. Export + delete + retention via `/api/v1/training`. |
| Marketing web | Reads only `NEXT_PUBLIC_API_URL`; proxies to the backend public ask route. No AI/DB/search secrets. |

Automated proof: `bash scripts/audit/sovereignty-audit.sh` (hard checks must exit 0)
and the `sovereignty.test.ts` fail-closed tests.

## Sovereign-compatible (depends on deployment)

These are architecturally sovereign but only *truly* sovereign when you run them
on infrastructure you control:

- **Inference** — a hosted openai-compatible gateway is sovereign-compatible.
  True 100% = self-hosted / private-cloud open-weight inference (vLLM, Ollama,
  TGI). See `.env.example`.
- **Database / realtime / storage** — Supabase-compatible; true 100% = private
  Postgres + private object storage + private realtime.
- **Calls** — LiveKit; sovereign only when self-hosted, optional otherwise.

## The path to true 100% sovereignty (infra, not code)

Do **not** migrate now unless requested — this is the documented target. Each
item is a deployment/ops task, surfaced honestly in `/status` until done.

1. Self-hosted / private-cloud open-weight inference (vLLM / Ollama / TGI).
2. Self-hosted / private Postgres (Supabase-compatible stack).
3. Private object storage.
4. Private realtime.
5. Self-hosted SearXNG + scraper (already deployable: `deploy/discovery-appliance`).
6. Self-hosted LiveKit for calls.
7. Encryption at rest + KMS-managed keys.
8. Automated backups + tested restore.
9. Monitoring + alerting on the private stack.
10. Immutable audit logs.
11. Customer data export + delete (training export/delete shipped; extend to full workspace).
12. Incident response runbook.

## What still requires human / env / infra setup

- Confirm RLS migrations are applied in production (provable isolation backstop).
- Verify the deployed environment has no stray legacy keys (CLERK/OPENAI/ANTHROPIC/TAVILY/NYLAS).
- Deploy SearXNG + scraper and set `SOVEREIGN_SEARCH_URL`/`SOVEREIGN_SCRAPE_URL`(+ `_KEY`).
- Set `AI_GATEWAY_*` to a private open-weight endpoint for true 100% AI sovereignty.
- Set `LIVEKIT_*` (self-hosted) to enable calls; otherwise they stay off by design.
