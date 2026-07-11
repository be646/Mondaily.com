# Operations Runbook — Private vLLM (day-2)

**Version:** 1.0.0 · preparation only. Operator actions on the GPU host, not this repo.

## Deploy
1. Provision the node (see `PRODUCTION_RUNBOOK.md §1`); attach it to the private network
   (WireGuard/Tailscale) — the proxy is the only reachable service.
2. Copy `templates/.env.example` → `.env` on the host; fill secrets (never commit).
3. Copy `templates/docker-compose.yml.template` → `docker-compose.yml`; set model names/ports/GPU ids.
4. Copy `templates/Caddyfile.template` (or `nginx.conf.template`) → proxy config; set domain + key.
5. `docker compose up -d` (or the systemd units below).
6. Verify: `bash healthcheck.sh` returns healthy; `curl -H "Authorization: Bearer $KEY" $URL/v1/models`.

### systemd alternative (instead of compose)
Two units, `vllm-small.service` and `vllm-large.service`, each running the vLLM command from the
compose template with `--disable-log-requests --enable-prefix-caching`, plus a `caddy.service` for
the proxy. Set `Restart=on-failure`, `RestartSec=5`, and `StandardOutput=null`/`journal` **without**
request bodies (vLLM already suppresses them). Enable with `systemctl enable --now`.

## Health
- Liveness: proxy `/healthz` → 200 when vLLM `/v1/models` responds.
- Readiness (HA): LB removes a node failing 3 consecutive `/healthz`.
- `healthcheck.sh.template` is a metadata-only probe (status + latency, no bodies) for cron/monitoring.

## Monitoring & alerts
Scrape (Prometheus/host agent):
- vLLM: request throughput, running/waiting queue, prefix-cache hit ratio, GPU util/mem, TTFT, p95.
- proxy: req/s, 4xx/5xx rate, per-key rate-limit rejections, upstream latency.
Alert on: endpoint down, 5xx rate > 1% (5 min), p95 latency > baseline × 1.5 (10 min), GPU mem > 95%,
auth-failure burst, prefix-cache ratio collapse (caching misconfigured).

## Key rotation
1. Generate a new proxy key; add as a second accepted key (dual-key window).
2. Update `AI_GATEWAY_API_KEY` in Vercel (API project) to the new key.
3. Confirm traffic flows on the new key; remove the old key from the proxy.
4. Rotate on schedule (e.g. quarterly) and immediately on suspected exposure.

## Incident quick-reference
| Symptom | First action |
|---|---|
| Chat/AI errors after a canary env change | **Roll back the class env** (see `ROLLBACK_CHECKLIST.md`) |
| Endpoint down | LB drains node; if single-node, roll back to hosted via env |
| Latency regression | check GPU util/queue depth; scale replicas or roll back class |
| JSON validity drop (extraction) | inspect guided-decoding config; roll back `AI_MODEL_EXTRACTION` |
| Suspected key leak | rotate proxy key + `AI_GATEWAY_API_KEY` immediately |

## Never
- Enable request/prompt logging.
- Expose a vLLM port publicly or without the proxy's auth.
- Flip multiple class envs at once, or a global base-URL switch, before canary passes.
- Touch memory Phase 2B, the gateway runtime, or production env outside the documented rollout.
