# Production Private-vLLM Inference Runbook

**Version:** 1.0.0 · **Date:** 2026-07-11 · **Status:** preparation only (no production change)

Keeps Mondaily's existing sovereign abstraction: the app talks to `AI_GATEWAY_BASE_URL` (OpenAI-
compatible) and resolves per-class models via `AI_MODEL_<CLASS>` (see `packages/api/src/lib/ai-router.ts`).
Going private = pointing those env vars at your own vLLM behind a proxy. **No app code changes.**

---

## 1. Production hardware tiers

| Tier | Hardware | Serves | Notes |
|---|---|---|---|
| **Validation only** | 1× RTX 4090 24 GB | one 7–8B | **NOT production** — see below |
| **Minimum viable prod** | 1× **L40S 48 GB** (or 1× A100 40 GB) | small 8–14B (+ 32B fp8 tight) | single node, no redundancy |
| **Recommended prod** | 1× **H100 80 GB** (or 2× L40S 48 GB) | small 8–14B **+** 70B fp8 co-resident | headroom, long context |
| **HA prod** | 2+ nodes × (1–8× H100), LB, N replicas | multi-replica per model, tensor-parallel large | zero-downtime, burst |

### Why the RTX 4090 is validation-only, not production
- **No ECC memory** and consumer thermals/power → not built for 24/7 sustained multi-tenant load.
- **24 GB VRAM** caps you at ~8B (or a tight 14B AWQ); no room for a 70B or long-context `meeting`.
- **Licensing:** NVIDIA's data-center software terms and many cloud providers restrict GeForce cards
  in production/datacenter use — a compliance risk for a paid product.
- **No NVLink / limited multi-GPU** scaling; can't tensor-parallel a large model.
- **Single point of failure** with no vendor SLA on the card.
- It is perfect for the cheap correctness check (Phase 3A.2) — parity, JSON, caching — and nothing more.

### When you need H100 / L40S / A100
- **L40S 48 GB:** cheapest *legit* production card; fits small models comfortably + a 32B fp8. Good
  **minimum viable** and good HA replica for the small/`fast`/`extraction` tier.
- **A100 40/80 GB:** mature datacenter option; 80 GB variant hosts a 70B fp8. Widely available.
- **H100 80 GB:** best perf/context; hosts **small + 70B fp8 co-resident**, fp8 throughput, long
  `meeting` contexts. The **recommended** single-node prod card and the HA building block.
- Rule of thumb: **need a 70B (`reasoning`/`meeting`) → need ≥80 GB (H100 or A100-80).** Small-only
  prod → an L40S is enough.

---

## 2. Production architecture

```
  Mondaily API (Vercel)  ── OpenAI-compatible HTTPS ──►  [ Reverse proxy ]  ──►  vLLM (small)
  AI_GATEWAY_BASE_URL      over private tunnel             • API-key auth          vLLM (large)
  AI_GATEWAY_API_KEY       (WireGuard / Tailscale /        • per-tenant rate limit
  AI_MODEL_<CLASS>          cloud private link)            • metadata-only logs
                                                           • health checks
                                                           • TLS termination
                          ══════════ PRIVATE NETWORK — no public ingress ══════════
```

Components:
- **vLLM OpenAI-compatible API** — one process per model, distinct ports; `--enable-prefix-caching`,
  `--disable-log-requests`. Drop-in for the app's existing `openai-compat` provider.
- **Reverse proxy** (Caddy or nginx) — the single public/tunnel entry; terminates TLS, enforces
  **API-key auth**, applies **rate limits**, exposes `/healthz`, and logs **metadata only**.
- **Private network** — the app reaches the proxy over **WireGuard / Tailscale** (or a cloud private
  link). No inference port is publicly reachable; the proxy is the only door.
- **No prompt logging** — vLLM `--disable-log-requests`; proxy access logs record method/status/
  latency/token counts, **never** request/response bodies.
- **Rate limits** — token-bucket per API key / per workspace header at the proxy.
- **Health checks** — proxy `/healthz` → vLLM `/v1/models`; LB uses it in HA.
- **Monitoring & alerts** — scrape vLLM/proxy metrics (throughput, queue depth, GPU util, p95
  latency, error rate); alert on endpoint-down, high error rate, latency regression, GPU OOM.

---

## 3. Deployment files (templates only — in `templates/`)

| Template | What it is | Operator fills in |
|---|---|---|
| `docker-compose.yml.template` | vLLM (small+large) + proxy, no-log flags | model names, GPU ids, ports |
| `Caddyfile.template` | proxy: auth, rate limit, `/healthz`, TLS | domain, upstream ports, key |
| `nginx.conf.template` | proxy alternative | same |
| `.env.example` | operator + Vercel env, documented | all secrets/URLs |
| `healthcheck.sh.template` | metadata-only probe (curl `/v1/models`) | endpoint + key |

Also in this package: `ROLLBACK_CHECKLIST.md`, `OPERATIONS_RUNBOOK.md`. A systemd unit alternative to
compose is documented inline in `OPERATIONS_RUNBOOK.md`.

---

## 4. Model tiers

| Class(es) | Tier | Suggested open-weight | Runs on |
|---|---|---|---|
| `fast`, `support`, `extraction`, `discovery` | **small 8–14B** (+ guided JSON for extraction/discovery) | Qwen2.5-7B/14B-Instruct, Llama-3.1-8B | **4090 (validation)**, L40S/A100/H100 (prod) |
| `summarization` | **mid 14–32B** | Qwen2.5-32B, Llama-3.3-70B fp8 | L40S (32B fp8 tight), A100-80 / H100 |
| `reasoning`, `meeting` | **large 70B fp8** | Llama-3.3-70B-Instruct fp8, Qwen2.5-72B | **A100-80 / H100 only** (needs ≥80 GB) |

- **What can run on a 4090:** one small 8B (or tight 14B AWQ), short context. Validation only.
- **What requires H100/L40S/A100:** anything 32B+ (summarization mid), and **all** 70B
  (`reasoning`/`meeting`) → **≥80 GB (H100/A100-80)**. L40S covers small + tight 32B.
- **Two-model prod baseline:** small (L40S/H100) for `fast`/`support`/`extraction`/`discovery`;
  large 70B fp8 (H100/A100-80) for `reasoning`/`meeting`/`summarization`. Each mapped by one
  `AI_MODEL_<CLASS>` env — no code.

---

## 5. Safe migration (order matters)

1. **Staging endpoint first** — stand up the prod stack on a **staging** proxy URL; never point prod
   env at it yet.
2. **Shadow eval** — run the approved `docs/ai-eval` harness (`node scripts/ai-eval/harness.mjs
   --offline`) against staging vs hosted. Gate on `PHASE_3A_EVAL_PLAN.md §5`.
3. **Canary `extraction` only** — set **`AI_MODEL_EXTRACTION`** to the private spec (single class,
   objective JSON gate). Nothing else moves.
4. **Monitor `ai_usage`** — watch `latency_ms`, `source_count`, `cache_status`, `provider`
   (=`AI_BACKEND_LABEL`) for the canary class. Compare to the hosted baseline window.
5. **Rollback by env** — regression → revert that one env var to the hosted spec (seconds, no deploy).
6. **`support` then `chat`(`fast`) next** — after extraction holds, promote in risk order.
7. **`reasoning` and `meeting` last** — highest quality bar + largest hardware; migrate only after the
   small tier is proven and the large-model eval passes.

Never flip a global switch. Migration is **per-class env**, one at a time, each behind its own gate.

---

## 6. Vercel env changes (later, when canary is authorized)

Set on the API project only, in this order — **no global switch until the canary passes**:

| Var | When | Value |
|---|---|---|
| `AI_GATEWAY_BASE_URL` | at cutover | private proxy URL (`https://…/v1`) — **or keep hosted and only move one class, see note** |
| `AI_GATEWAY_API_KEY` | at cutover | the proxy's API key |
| `AI_BACKEND_LABEL` | canary start | `vllm-private` (observability label in `ai_usage.provider`) |
| `AI_MODEL_EXTRACTION` | **canary #1** | `openai-compat/<small-model-served-name>` |
| `AI_MODEL_SUPPORT`, `AI_MODEL_FAST` | after extraction holds | small model spec |
| `AI_MODEL_SUMMARIZATION`, `AI_MODEL_MEETING`, `AI_MODEL_REASONING` | **last** | large model spec |

> **Note on the base URL during canary.** The current gateway routes all classes through one
> `AI_GATEWAY_BASE_URL`. Truly moving *only* extraction while everything else stays hosted requires
> the private proxy to be the base URL AND to **forward non-private models upstream to hosted**, OR
> the optional `AI_GATEWAY_FALLBACK_BASE_URL` (an *optional future* gateway change, out of scope
> here). Simplest first canary that needs **zero** gateway code: proxy fronts both — private small
> model for extraction, transparent pass-through to hosted for everything else. Document the chosen
> path before cutover.

---

## 7. Production acceptance criteria

Promote a class from canary → full only when, over the monitored window:
- **JSON validity ≥ 99%** (`extraction`/`discovery`, from harness + live `ai_usage` spot checks).
- **Latency:** private **p95 ≤ hosted × 1.5** for the class (baseline hosted p50 ≈ 859 ms).
- **Refusal behavior:** parity with hosted on must-refuse cases; no new over-refusal.
- **Source grounding:** rubric/human (or LLM-judge) within tolerance of hosted; no fabrication.
- **Uptime ≥ 99.5%** on the endpoint during the window (HA target higher).
- **Error rate < 1%** (5xx / timeouts) at the proxy for the class.
- **Rollback tested** — env revert exercised at least once and confirmed to restore hosted behavior.

Any miss → stay on hosted for that class, iterate.

---

## 8. Security

- **No public unauthenticated endpoint** — vLLM never exposed directly; proxy requires a valid API
  key; inference ports bound to the private network only.
- **No prompt/response logs** — `--disable-log-requests` on vLLM; proxy logs metadata only. Aligns
  with the memory principle: recalled/inference content is never persisted to logs.
- **Key rotation** — proxy API key rotated on a schedule and on suspicion; rotate `AI_GATEWAY_API_KEY`
  in Vercel in lockstep (same cadence as today's gateway key).
- **Workspace isolation stays upstream** — the app already scopes every prompt to one workspace;
  inference is stateless (prefix KV cache is content-addressed + ephemeral, not tenant-keyed). Never
  delegate tenancy to the model layer.
- **DDoS / rate limiting** — per-key + per-workspace token buckets at the proxy; connection limits;
  optional IP allowlist to the app's egress range.
- **Alerts** — endpoint-down, error-rate spike, latency regression, GPU OOM, auth failures burst.

---

## 9. Cost

**Estimates — verify against live quotes.** Reserved GPU pricing varies by provider/commitment.

| Tier | Hardware | ~Monthly | Serves |
|---|---|---|---|
| Minimum viable | 1× L40S 48 GB | **~$900–1,600** | small tier only |
| Recommended | 1× H100 80 GB | **~$1,800–2,800** | small + 70B |
| HA | 2× H100 (+ LB) | **~$4,000–6,000+** | redundant, burst |

**Break-even vs hosted:** `monthly_GPU / hosted_price_per_token`. At ~$2,300/mo and $0.50–1.50/M
tokens → **~1.5–4.6 B tokens/month**.

**Current Mondaily reality (from `ai_usage`, 2026-07):** ~**1–2 M tokens/month**, 91% prompt-heavy.
That is **~1,000× below break-even** — private inference is **not** cost-justified today. Its value
now is **sovereignty, data residency, and control**, not savings. Re-run the break-even automatically
once monthly volume crosses **~500 M tokens**; only then does a reserved GPU pay for itself.

---

## 10. What must NOT change
- Live inference, production env, and the AI gateway **runtime** (`ai-gateway.ts`) — untouched.
- Memory Phase 2B (recall, Ask injection, `source_count`, disclosure) — frozen.
- `modelForClass` signature, the seven-class taxonomy, `AI_MODEL_<CLASS>` names, fail-closed guard.
- App frontend, `ai_usage` schema (`cache_status` column already exists).
- Workspace isolation stays at the query layer.

This is a preparation package. Applying it is a separate, explicitly-approved rollout (Phase 3B+),
one class at a time, each behind its own gate and env-based rollback.
