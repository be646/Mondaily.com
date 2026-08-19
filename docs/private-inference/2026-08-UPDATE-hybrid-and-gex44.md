# 2026-08 Update — Hybrid Mode, the Cerebras Ending, and the GEX44 Cutover

**Date:** 2026-08-19 · **Status:** the runbooks in this folder remain valid; this update aligns them
with the inference-backend registry that shipped AFTER they were written (2026-07-31), and records
what actually happened in production.

## What happened (so nobody has to rediscover it)

Heavy AI ran on a Cerebras **free-tier** account from 2026-06-25 (created via GitHub OAuth, welcome
email in the operator's inbox) until Cerebras ended free Developer-tier access **effective
2026-08-17** (they emailed 30 days' notice on 2026-07-16). Production started returning 402 on
2026-08-19. There was never a funded account. The operator's standing direction since:
**no AI-vendor APIs at all — sovereign hardware only.**

## What exists TODAY (verified live 2026-08-19)

- Engine: **Ollama** on the CCX box (`.138`, 2 vCPU / 8 GB), serving `qwen2.5:3b` behind TLS+bearer
  at the URL in `SOVEREIGN_VLLM_URL`. Measured: models RT 33ms, 1-token completion ≈ 4.7s (CPU).
- Gateway modes (`packages/api/src/lib/inference-backend.ts`):
  - `gateway` — external OpenAI-compatible endpoint (dead since the 402).
  - `sovereign_vllm` — EVERYTHING on the own engine, fail-closed, no external env required.
  - `hybrid_sovereign` — **live in production now**: classes in `AI_SOVEREIGN_CLASSES`
    (currently `fast`) ride the own engine; tool rounds would ride external (currently dead →
    honest fallbacks). Tool-free turns and the tool-less recovery path answer sovereign.
- Shadow evaluation (AI Control Room) is THE promotion gate: qwen2.5:3b measured **93% error on
  extraction, 5% similarity on tool tasks** — which is why tool traffic is not routed to it.

> The original PRODUCTION_RUNBOOK's cutover env was `AI_GATEWAY_BASE_URL → own vLLM`. That still
> works, but the REGISTRY path is now preferred: set `SOVEREIGN_VLLM_URL/MODEL/KEY` and flip
> `SOVEREIGN_INFERENCE_MODE`. It is fail-closed per mode and never leaks across the sovereignty
> boundary; hybrid additionally allows per-class migration with shadow proof.

## Step now (current box, no new spend): 3B → 7B

Two commands on `.138` (operator, SSH):

```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
# context: our prompts run 3.5k+ tokens; default 4k ctx truncates them.
# 8 GB box: 7B-q4 (~4.7 GB) + KV cache — set ctx 8192 (NOT 16k; it will not fit with STT resident).
sudo systemctl edit ollama    # add: Environment="OLLAMA_CONTEXT_LENGTH=8192"
sudo systemctl restart ollama
```

Then (Claude, from the deployment side): set `SOVEREIGN_VLLM_MODEL=qwen2.5:7b-instruct-q4_K_M` in
Vercel prod, redeploy, verify via the Control Room handshake (served model must change), keep
`AI_SOVEREIGN_CLASSES=fast` until shadow-eval numbers justify promoting `summarization`.
Expectation-setting: 7B improves fluency and summaries; it does NOT make tool-use trustworthy.

## The heavy-tier cutover: Hetzner GEX44 (when the operator pulls the trigger)

Same Hetzner console as the two existing servers. This is the smallest hardware where
"top-tier + fast + fully sovereign" are simultaneously true.

| | GEX44 |
|---|---|
| GPU | RTX 4000 SFF Ada, 20 GB VRAM |
| Price | ≈ €184/mo (+ one-time setup) |
| Model to run | **Qwen2.5-32B-Instruct-AWQ** (~18 GB — fits; strong tool use) — fallback Qwen2.5-14B-AWQ if headroom issues |
| Expected speed | 30–60 tok/s generation; prefix caching on (`--enable-prefix-caching`) |
| Engine | vLLM per `PRODUCTION_RUNBOOK.md §1` + `templates/docker-compose.yml.template` |

Cutover sequence (supersedes §"cutover" env of the old runbook):
1. Provision GEX44 → follow `PRODUCTION_RUNBOOK.md §1` (OS, docker, private network, proxy+TLS+key).
2. `docker compose up -d` with vLLM serving Qwen2.5-32B-Instruct-AWQ, `--enable-prefix-caching`.
3. Point `SOVEREIGN_VLLM_URL/KEY/MODEL` at the NEW box (the CCX box keeps STT; its Ollama can retire
   or stay as fallback for the fast class).
4. Shadow first: keep mode `hybrid_sovereign`, set `SOVEREIGN_VLLM_SHADOW_PCT` up, read the
   per-class table in the AI Control Room until extraction/reasoning similarity is acceptable.
5. Promote by evidence: `AI_SOVEREIGN_CLASSES=fast,summarization,extraction,…` class by class.
6. Full independence: `SOVEREIGN_INFERENCE_MODE=sovereign_vllm` (carries tool turns; requires no
   external env — hardened 2026-08-19), then DELETE `AI_GATEWAY_BASE_URL/API_KEY` from Vercel and
   revoke the Cerebras GitHub OAuth grant.
7. Rollback: `ROLLBACK_CHECKLIST.md` unchanged.

## Standing rules (unchanged, load-bearing)

- Promotion of a task class to the sovereign engine is a **deliberate env change backed by shadow
  numbers** — never automatic, never hoped.
- Sovereign modes **fail closed**. A dead own-engine is an honest error, never a silent hop to a
  cloud endpoint.
- The watchdog probes both engines every 15 minutes and emails the operator on transitions.
