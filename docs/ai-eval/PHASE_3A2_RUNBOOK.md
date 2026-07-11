# Phase 3A.2 — Test-GPU Runbook (RTX 4090 + vLLM)

**Version:** 1.0.0 · **Date:** 2026-07-11 · **Status:** ready to execute · **Scope:** offline validation only.

Runs the approved `scripts/ai-eval/harness.mjs` against a **temporary** private vLLM endpoint and the
current hosted baseline. **No production change**: no app routing/env, no AI gateway, no memory, no
Ask, no agents, no prompts, no production inference are touched. This is a throwaway GPU + a local
harness run. Tear the GPU down when done.

> Golden rule: the private endpoint you stand up here is **never** wired into Mondaily. Only the
> local harness (your laptop/CI shell) talks to it, via `EVAL_*` env vars. The live app keeps using
> its existing `AI_GATEWAY_*` config unchanged.

---

## 0. Prerequisites
- An account on an on-demand GPU host (Runpod or Vast.ai recommended for cheapest 4090).
- The current hosted gateway base URL + a key you can use for read-only eval calls (the SAME
  OpenAI-compatible endpoint the app uses — you are only *measuring* it, not changing it).
- This repo checked out locally with Node ≥ 22 (for `node scripts/ai-eval/harness.mjs`).

---

## 1. Provision a temporary RTX 4090

**Runpod (example path):**
1. Runpod → **Pods** → Deploy → GPU: **1× RTX 4090 (24 GB)**, on-demand (not spot, to avoid mid-run eviction).
2. Template: **"vLLM"** official image, or a plain **PyTorch/CUDA 12.x** image if you install vLLM yourself.
3. Disk: ~40–60 GB (model weights + KV cache scratch).
4. **Networking:** expose **one** HTTP port (default vLLM `8000`). Prefer Runpod's **TCP proxy /
   authenticated proxy URL** over a raw public IP. Do **not** open extra ports.
5. Region: closest to where you'll run the harness (keeps latency numbers honest).
6. Launch; note the proxy hostname (e.g. `https://<pod-id>-8000.proxy.runpod.net`).

**Vast.ai (alternative):** rent a single 4090, choose a vLLM/PyTorch image, map port 8000, use the
provided proxy URL. Same shape.

> Keep the pod **on** only for the run. Cheapest correctness = provision → eval → destroy same session.

---

## 2. Recommended first test model (small only)

Serve **one small instruct model** covering `extraction` / `discovery` / `support` (and it also
exercises `fast`/`summarization` acceptably for a first pass):

- **First choice:** `Qwen/Qwen2.5-7B-Instruct` — strong JSON/tool-use, fits 4090 comfortably, good
  guided-decoding behavior for the extraction/discovery JSON gates.
- **Alternative:** `meta-llama/Llama-3.1-8B-Instruct` (gated download; request access first).
- Optional quantization if VRAM is tight with a long context: an **AWQ** build
  (e.g. `Qwen/Qwen2.5-7B-Instruct-AWQ`).

**Do NOT test the 70B `reasoning`/`meeting` tier in this pass.** It does not fit a single 4090 well.
See the **Optional 70B step** at the end — a separate, deliberate A100/H100 spot session, only if
you choose to.

---

## 3. vLLM launch command

On the pod shell (install if the image lacks it: `pip install vllm`):

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b \
  --host 0.0.0.0 --port 8000 \
  --api-key "$VLLM_API_KEY" \
  --enable-prefix-caching \
  --disable-log-requests \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.90
```

Flag rationale:
- `--enable-prefix-caching` → populates `usage.prompt_tokens_details.cached_tokens` so the report's
  **cache** column is real (this is what the 91%-prompt-share traffic will benefit from).
- `--disable-log-requests` → **no prompt/response bodies in server logs** (sovereignty: no prompt logs).
- `--api-key "$VLLM_API_KEY"` → bearer-token auth on the endpoint (set a strong random value first:
  `export VLLM_API_KEY=$(openssl rand -hex 24)`).
- `--max-model-len 8192` → safe context for the small fixtures; raise only if a fixture needs it.
- `--gpu-memory-utilization 0.90` → headroom on 24 GB.

Smoke-check from the pod (no prompt logged; trivial call):
```bash
curl -s http://localhost:8000/v1/models -H "Authorization: Bearer $VLLM_API_KEY"
```

---

## 4. Network / security setup

- **API key:** the endpoint requires the bearer `VLLM_API_KEY`. Never commit it; keep it in your
  shell only.
- **No public prompt logs:** `--disable-log-requests` is mandatory. Also avoid piping server stdout
  to any shared location. The harness itself logs **no** URLs/keys and writes reports locally only.
- **Temporary endpoint:** use the host's proxy URL; do not attach a stable DNS name. Treat the URL
  as ephemeral and secret-ish.
- **Least exposure:** one port (8000) only; auth on; region-local. No inbound beyond the proxy.
- **Teardown (do this every time):**
  1. Stop the vLLM process (`Ctrl-C`).
  2. **Destroy / terminate the pod** in the host console (not just "stop" — destroy so billing ends
     and weights/KV scratch are gone).
  3. `unset VLLM_API_KEY` and the `EVAL_PRIVATE_*` vars in your local shell.
  4. Delete local `scripts/ai-eval/runs/<timestamp>/` if the responses shouldn't be retained.

---

## 5. Local env vars for the harness

Set these **locally** (where you run the harness), never in Vercel/production:

```bash
# Hosted baseline — the SAME OpenAI-compatible endpoint the app already uses (measure only)
export EVAL_HOSTED_BASE_URL="https://<hosted-gateway>/v1"
export EVAL_HOSTED_API_KEY="<hosted key>"
export EVAL_HOSTED_MODEL="<hosted model id>"       # e.g. the current gpt-oss-120b spec's model id

# Private candidate — the temporary 4090 vLLM endpoint
export EVAL_PRIVATE_BASE_URL="https://<pod-id>-8000.proxy.runpod.net/v1"
export EVAL_PRIVATE_API_KEY="$VLLM_API_KEY"
export EVAL_PRIVATE_MODEL="qwen2.5-7b"             # must match --served-model-name
```

Notes:
- Base URLs include the `/v1` suffix; the harness appends `/chat/completions`.
- These are `EVAL_*` names — **distinct** from the app's `AI_GATEWAY_*` / `AI_MODEL_*`. The harness
  reads only `EVAL_*` and fails closed if any of the six is missing.

---

## 6. Commands to run

From the repo root:

```bash
# a) Dry run — validate fixtures only, NO network, NO env required
pnpm eval:ai:dry-run
#   → expect: "[eval] dry-run PASS — 17 fixtures across 7 classes valid."

# b) Class-filtered eval — start with the JSON-gated classes (needs EVAL_* env)
node scripts/ai-eval/harness.mjs --offline --class=extraction
node scripts/ai-eval/harness.mjs --offline --class=discovery

# c) Full offline eval — all classes (needs EVAL_* env)
pnpm eval:ai:offline
```

Recommended order: **(a) always first** → **(b) extraction then discovery** (cheapest, objective
JSON gate) → **(c) full sweep** once those look right. Reports land in
`scripts/ai-eval/runs/<timestamp>/` as `report.json` + `report.md`.

---

## 7. How to read the report

`report.md` has one row per fixture per side (`hosted` / `private`):

| Column | Meaning | What "good" looks like |
|---|---|---|
| `lat ms` | round-trip latency | private p95 ≤ hosted × 1.5 |
| `prompt tok` / `compl tok` | token usage from `usage` | private not wildly more verbose than hosted |
| `cached` | `prompt_tokens_details.cached_tokens` | **> 0 on repeated prefixes** = prefix caching working (null = endpoint didn't report) |
| `json` | `parsed && conformant` (extraction/discovery) | `true` — target ≥ 99% across the class |
| `refusal✓` | `refused === must_refuse` | `true` — matches expected refuse/answer |

`report.json` holds the full structured records for scripting/aggregation. **Source-grounding is a
placeholder (`grounding: null`)** — score those items by rubric/human or an LLM-judge pass per
`RUBRICS.md`; the harness does not auto-grade prose correctness.

Sanity checks:
- All `json` cells `true` for extraction/discovery? If any `false`, inspect the raw output in
  `report.json` — usually a schema/grammar gap, tighten guided decoding.
- `cached` non-zero on the second identical-prefix call? Confirms `--enable-prefix-caching`.
- `refusal✓` `true` on the must-refuse fixtures (support-002/003, extraction-003, discovery-002)?

---

## 8. Go / No-Go criteria (feeds the Phase 3B decision)

**GO to plan Phase 3B canary if, on this small-model pass:**
- `extraction` + `discovery` **JSON parse + schema conformance ≥ 99%**.
- Refusal parity: private matches expected on **all** must-refuse fixtures; no over-refusal on
  answerable ones.
- `support` grounding (rubric/human spot-check) within tolerance of hosted; no fabricated capabilities.
- **p95 latency ≤ hosted × 1.5** on the tested classes.
- Prefix caching demonstrably reduces prompt tokens (`cached` > 0 on repeated prefixes).
- Endpoint ran with auth on, `--disable-log-requests`, single port, and was destroyed after.

**NO-GO (stay in 3A, iterate model/flags):**
- JSON validity < 99% on structured classes.
- Any must-refuse fixture answered, or heavy over-refusal.
- p95 latency > hosted × 2.
- Caching shows no effect, or the endpoint couldn't run without prompt logging.

A GO here authorizes **planning** Phase 3B only — it does **not** change any app env. Phase 3B remains
a separate, explicitly-approved step (canary one class via a single `AI_MODEL_<CLASS>` env, hosted
rollback armed).

---

## 9. Estimated cost & runtime

- **GPU:** RTX 4090 on-demand ≈ **$0.35–0.55/hr**. A provision→eval→teardown session is well under an
  hour → **~$0.30–0.60 total**.
- **Model pull:** 7–8B weights ≈ 15–16 GB → a few minutes on a fast pod link.
- **Harness runtime:** 17 fixtures × 2 endpoints = 34 calls; at low concurrency this is **~1–3
  minutes** of wall-clock (dominated by model latency, not the harness).
- **Net:** the full Phase 3A.2 pass is a **sub-hour, sub-dollar** exercise. This is a capability/
  sovereignty check, not a cost-savings run (private is ~1,000× above break-even at current volume).

---

## Optional (separate) — 70B reasoning/meeting spot check
Only if you deliberately choose to validate the large tier now:
1. Provision **1× A100 80GB or H100 80GB** (spot ok for a short run).
2. Serve an fp8 70B (e.g. `--model <llama-3.3-70b-fp8> --served-model-name llama-70b --max-model-len 8192 --enable-prefix-caching --disable-log-requests`).
3. Point `EVAL_PRIVATE_MODEL=llama-70b`, run `--offline --class=reasoning` and `--class=meeting`.
4. Tear down immediately (A100/H100 ≈ $1.1–2.8/hr). Keep it a single short session.

---

## Boundaries honored
Docs-only runbook. No app code, routing, env, gateway, memory, Ask, agents, prompts, or production
inference changed. The harness and fixtures referenced here are the already-approved Phase 3A/3A.1
assets, unchanged.
