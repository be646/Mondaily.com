# Mondaily Private Inference — Production Runbook Package

**Status:** preparation only. **Version:** 1.0.0 (2026-07-11). **Not implemented, not wired.**

A production-ready **plan + templates** for moving Mondaily from hosted OpenAI-compatible inference
to self-hosted open-weight vLLM, **keeping the existing `AI_GATEWAY_BASE_URL` abstraction**. Nothing
here changes live inference, production env, the AI gateway runtime, memory Phase 2B, or starts a
canary. Templates are inert (`*.template`) and imported/executed by nothing.

> **Hard boundary.** No file here is referenced by `apps/` or `packages/`. The `*.template` files are
> copied out and filled in **by an operator on the GPU host**, never run from this repo. Applying any
> of it to production is a separate, explicitly-approved step (Phase 3B+).

## Contents

| File | Purpose |
|---|---|
| `PRODUCTION_RUNBOOK.md` | Hardware tiers, architecture, model tiers, migration, Vercel env, acceptance, security, cost |
| `OPERATIONS_RUNBOOK.md` | Day-2 ops: deploy, health, monitoring/alerts, key rotation, incident steps |
| `ROLLBACK_CHECKLIST.md` | Exact env-based rollback, per stage |
| `templates/docker-compose.yml.template` | vLLM + reverse proxy, no prompt logging |
| `templates/Caddyfile.template` | Reverse proxy w/ auth + rate limit (auto-HTTPS) |
| `templates/nginx.conf.template` | Reverse proxy alternative |
| `templates/.env.example` | All operator + Vercel env vars, documented |
| `templates/healthcheck.sh.template` | Metadata-only liveness/readiness probe |

## Relationship to prior phases
- Reuses the **already-approved** offline harness + fixtures in `docs/ai-eval/` for shadow eval.
- Follows the sizing/break-even analysis in `docs/ai-eval/PHASE_3A_EVAL_PLAN.md`.
- The 4090 validation path lives in `docs/ai-eval/PHASE_3A2_RUNBOOK.md`; **this** package is the
  step *after* validation — real production hardware, HA, security, ops.

> **Read first:** [2026-08-UPDATE-hybrid-and-gex44.md](./2026-08-UPDATE-hybrid-and-gex44.md) — what actually happened in production (the Cerebras free tier ended), the hybrid mode that now exists, and the current GEX44 cutover sequence. The runbooks below remain valid for provisioning details.
