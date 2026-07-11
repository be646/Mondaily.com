# Phase 3A — Private Inference Eval Plan

**Version:** 1.0.0 · **Date:** 2026-07-11 · **Owner:** AI infra · **Status:** approved, not executed

Changelog:
- 1.0.0 (2026-07-11) — initial versioned plan.

---

## 1. Goal & non-goals

**Goal:** produce evidence that a private, self-hosted, open-weight vLLM backend can match the
current hosted OpenAI-compatible gateway per task class, so a later canary (Phase 3B) is safe.

**Non-goals (Phase 3A):**
- No production GPU routing.
- No change to app code, `ai-gateway.ts`, `ai-router.ts`, memory/Ask/agents/prompts, or env.
- No cost-savings claim — at current volume (~1–2 M tok/mo) private is ~1,000× above break-even.
  Phase 3A is a **sovereignty + capability readiness** exercise, not a savings play.

**Context (from live `ai_usage`, 2026-07-11):**
- ~2.17 M tokens / 30 days; ~1–2 M/mo run-rate; **91% prompt tokens** (prefix-cache-friendly).
- `task_class` populated only on recent rows (Phase 1 observability); older rows keyed by `feature`.
- Break-even ≈ 1.5–4.6 B tok/mo. Re-run the break-even calc automatically once monthly volume
  exceeds ~500 M tokens.

---

## 2. What is validated

For each task class: does the private model produce **equivalent quality, valid structure, correct
refusals, and acceptable latency** vs the hosted baseline, and does **prefix caching** deliver a
measurable prompt-token reduction?

Classes and their two-model baseline mapping:

| Class | Baseline model tier | Notes |
|---|---|---|
| `fast` (chat) | small 8B | latency-critical |
| `support` | small 8B (source-grounded) | refusal parity is the key metric |
| `extraction` | small 8–14B + guided JSON | JSON validity gate |
| `discovery` | small 8–14B + guided JSON | JSON validity gate |
| `summarization` | mid 14–32B | faithfulness / no added claims |
| `meeting` | large 70B fp8 | long-context recall |
| `reasoning` | large 70B fp8 | highest quality bar, validated **last** |

---

## 3. Method

1. Assemble golden fixtures (`fixtures/*.jsonl`), **20–30 items/class**, synthetic + sanitized-real.
2. Run each fixture through: (a) hosted baseline, (b) private candidate — **offline**, no user traffic.
3. Score with `RUBRICS.md`. Record latency + token usage + cache metrics from each response.
4. Produce a per-class scorecard and an overall go/no-go against §5 gates.

Build/validate order (lowest risk first): `extraction` → `discovery` → `fast` → `support` →
`summarization` → `meeting` → `reasoning`.

---

## 4. Metrics (see RUBRICS.md for scales)
- Source grounding / correctness
- JSON validity (extraction, discovery)
- Refusal behavior (support primary)
- Latency (p50/p95) — hosted baseline p50 ≈ 859 ms on chat/reasoning
- Token usage (prompt/completion per call vs hosted)
- Cache-hit potential (`cached_tokens / prompt_tokens` with prefix caching on)

---

## 5. Go / No-Go gates for Phase 3B

**GO if all hold on the golden set:**
- vLLM serves OpenAI-compatible responses with the **same request shape** (no client change).
- `extraction` + `discovery` **JSON validity ≥ 99%** (guided decoding).
- `fast`/`support` quality within rubric tolerance of hosted; **refusal parity** on must-refuse items.
- **p95 latency ≤ hosted × 1.5** per class.
- Prefix caching shows a **measurable** `cached_tokens` reduction on repeated system prompts.
- Private network verified: no public ingress, **no prompt logging**, metadata-only audit.
- Instant **env rollback** rehearsed (flip class env back to hosted).

**NO-GO (stay in 3A) if any:**
- JSON validity < 99% on structured classes.
- `reasoning` quality regression vs hosted.
- p95 latency > hosted × 2.
- Cannot run privately without prompt logging.

**On GO:** Phase 3B canaries a **single** class via one env var (`AI_MODEL_EXTRACTION=…`),
monitored through `ai_usage`, hosted rollback armed. No other change.

---

## 6. Test environment

**First test GPU: on-demand RTX 4090** (Runpod/Vast.ai, ~$0.35–0.55/hr), torn down between runs.
- Fits 8B fp8/AWQ comfortably; 14B AWQ tight — enough for all small-model classes.
- A full sweep is minutes of GPU time → a few dollars total.
- Validate the 70B `reasoning`/`meeting` tier in a **single short A100/H100 spot session** only when
  those classes come up. **No reserved GPU in Phase 3A.**

vLLM launch flags to exercise (documented for the operator; not run here):
`--enable-prefix-caching`, guided decoding (xgrammar/outlines) for JSON classes,
`--disable-log-requests` (no prompt logging), explicit `--max-model-len` for `meeting`.

---

## 7. Boundaries honored
No runtime behavior change. No memory Phase 2B changes. No env changes. Docs + fixtures only.
