# Sovereign STT Appliance — Production Validation & Deployment Plan

> **Long-term, "good forever" plan.** The target runtime is a **Linux appliance**, never a developer
> laptop. Local Mac Docker is explicitly **irrelevant** to this plan. This document is the standing
> reference for validating and deploying the sovereign live-STT appliance (`POST /caption/chunk`,
> `GET /health`, `GET /ready`, plus the batch `POST /transcribe`).
>
> Scope guardrails (unchanged): this is appliance + ops only. It does **not** wire Mondaily app/API,
> does **not** set `SOVEREIGN_STT_CHUNK_URL`, and touches no captions UI / call room / Meeting Memory /
> prompts / billing / records / private inference / Vercel env.
>
> Companions: [`LIVE_CAPTIONS_STT_CONTRACT.md`](./LIVE_CAPTIONS_STT_CONTRACT.md) (the endpoint
> contract) and [`RUNTIME_VALIDATION.md`](./RUNTIME_VALIDATION.md) (the quick copy-paste runbook —
> this document is the production superset).

---

## 0. Where Mac fits: nowhere

Mac/laptop Docker is **not required** and is not part of any gate. All validation runs on a Linux host
(a cheap cloud VM is fine for Tier A). This keeps the process reproducible and independent of any one
person's machine.

---

## 1. Standard supported runtime

| Layer | Standard |
|---|---|
| OS | **Ubuntu 22.04 LTS or 24.04 LTS** (x86_64; arm64 works for CPU tiers) |
| Engine | **Docker Engine + `docker compose` plugin** (v2), from Docker's official apt repo |
| Container base | **`python:3.11-slim`** (already set in `stt/Dockerfile`) |
| Dependencies | **pinned** `stt/requirements.txt` — `numpy==2.2.1`, `faster-whisper==1.1.1`, `python-multipart==0.0.20`, `anyio==4.12.1`, `fastapi==0.115.6`, `uvicorn==0.34.0`, `httpx==0.28.1` (+ transitive `ctranslate2`, `onnxruntime`, `av`) |
| Process model | **single uvicorn worker** per container (the concurrency gauge + `/ready` are per-process) |
| Dependency on laptops | **none** |

`python:3.11-slim` satisfies `numpy==2.2.1` (needs ≥3.10). `faster-whisper==1.1.1` imposes no numpy
upper bound; `onnxruntime` needs `numpy>=1.21.6` — so the pins co-resolve. The numpy-2 C-ABI is
settled by the Tier-A import check (§4, step 3).

---

## 2. Two validation tiers

### Tier A — CPU validation (approves Phase 2 **staging** wiring)
- **Host:** 2–4 vCPU, 8 GB RAM, 30–50 GB disk, Ubuntu 22.04/24.04.
- **Model:** `WHISPER_MODEL=tiny.en` (fastest) or `base.en` (pilot quality).
- **Proves:** Docker build with exact pins, endpoint contract, auth, privacy (metadata-only logs / no
  audio persisted), failure modes (415/413/401/503/504), and a **latency baseline**.
- **Not for production traffic** — CPU can't meet multi-participant live-caption latency at scale.

### Tier B — GPU production validation (required before production live-caption rollout)
- **Host:** Ubuntu 22.04/24.04 + NVIDIA driver + **NVIDIA Container Toolkit**; GPU image variant
  (`WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE=float16`).
- **GPU guidance:**
  | GPU | Use |
  |---|---|
  | **L4** (24 GB) | best price/perf for streaming captions; recommended default |
  | **L40S** (48 GB) | higher throughput / larger models / more concurrency |
  | **A10** (24 GB) | solid alternative to L4 |
  | **A100 / H100** | large-scale or lowest-latency `large-v3`; usually overkill for captions |
- **Model options:** `base.en`/`small` (CPU pilot) → **`distil-large-v3`** (recommended GPU: fast +
  accurate) or `large-v3` faster-whisper variants for max accuracy.
- **Proves:** production **live-caption latency** (warm decode well under chunk duration) and
  **accuracy** (proper nouns, multi-speaker rooms) at the target concurrency.

---

## 3. Clean Ubuntu host — exact commands

### 3.1 Install Docker Engine + compose plugin
```bash
# Ubuntu 22.04/24.04 — official Docker apt repo
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER" && newgrp docker   # optional: run docker without sudo
docker info | grep -i "server version"
```

### 3.2 (Tier B only) NVIDIA Container Toolkit
```bash
# Assumes NVIDIA driver already installed (nvidia-smi works).
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
docker run --rm --gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi   # sanity
```
> The committed `Dockerfile`/`docker-compose.yml` are the **CPU** build. For Tier B, use the GPU image
> variant per `README.md` (CUDA base + `WHISPER_DEVICE=cuda`) and add `deploy.resources.reservations.
> devices` (or `--gpus all`) — GPU compose changes are a separate, explicit step, not done here.

### 3.3 Clone, checkout, configure
```bash
git clone https://github.com/be646/Mondaily.com.git
cd Mondaily.com
git checkout main && git pull --ff-only
cd deploy/stt-appliance

export STT_API_KEY="$(openssl rand -hex 16)"     # session secret (required)
export WHISPER_MODEL=base.en                       # Tier A: tiny.en|base.en ; Tier B: distil-large-v3
```

### 3.4 Build & run
```bash
STT_API_KEY="$STT_API_KEY" WHISPER_MODEL="$WHISPER_MODEL" docker compose up -d --build
docker compose ps
docker compose logs -f stt   # wait for "Application startup complete" (model download on first boot)
```
`STT_MAX_CONCURRENCY` is not forwarded by compose but **defaults to 2**. To set it explicitly, add it
under `services.stt.environment` in a compose override or run the container with `-e STT_MAX_CONCURRENCY=2`.

### 3.5 Dependency proof (exact pins + ABI)
```bash
docker compose exec stt python --version   # Python 3.11.x
docker compose exec stt pip freeze | grep -Ei '^(numpy|faster-whisper|ctranslate2|onnxruntime|av|python-multipart|anyio|fastapi|uvicorn|httpx)=='
# Must include: numpy==2.2.1, faster-whisper==1.1.1, python-multipart==0.0.20, anyio==4.12.1
docker compose exec stt python -c "import numpy,ctranslate2,onnxruntime,av,faster_whisper; print('imports OK', numpy.__version__)"
```

### 3.6 Health / ready
```bash
curl -s localhost:8090/health | python3 -m json.tool   # ready:true, concurrency{active:0,max:2}
curl -s localhost:8090/ready  | python3 -m json.tool   # 200 ready:true
```

### 3.7 caption/chunk tests
Generate samples on the Linux host (ffmpeg):
```bash
sudo apt-get install -y ffmpeg
# Provide any speech file as source.mp3/wav, or synth with espeak-ng:
sudo apt-get install -y espeak-ng
espeak-ng -w /tmp/raw.wav "hello this is a live captions test for mondaily"
ffmpeg -y -i /tmp/raw.wav -ac 1 -ar 16000 -acodec pcm_s16le speech.wav
ffmpeg -y -i speech.wav -f s16le -ac 1 -ar 16000 speech.pcm
python3 -c "import numpy as np; open('silence.pcm','wb').write(np.zeros(2*16000,dtype='<i2').tobytes())"
head -c 11000000 /dev/zero > big.pcm
```
Run the matrix:
```bash
U=localhost:8090; A="Authorization: Bearer $STT_API_KEY"
curl -s -w '\n[%{http_code} %{time_total}s]\n' -H "$A" -F audio=@speech.wav  -F format=wav       -F sample_rate=0     -F session=t -F seq=1 $U/caption/chunk
curl -s -w '\n[%{http_code} %{time_total}s]\n' -H "$A" -F audio=@speech.pcm  -F format=pcm_s16le -F sample_rate=16000 -F session=t -F seq=2 $U/caption/chunk
curl -s -w '\n[%{http_code} %{time_total}s]\n' -H "$A" -F audio=@silence.pcm -F format=pcm_s16le -F sample_rate=16000 -F session=t -F seq=3 $U/caption/chunk
curl -s -o /dev/null -w 'webm→%{http_code}\n'  -H "$A" -F audio=@speech.pcm  -F format=webm_opus -F session=t -F seq=4 $U/caption/chunk
curl -s -o /dev/null -w 'big→%{http_code}\n'   -H "$A" -F audio=@big.pcm     -F format=pcm_s16le -F sample_rate=16000 -F session=t -F seq=5 $U/caption/chunk
curl -s -o /dev/null -w 'noauth→%{http_code}\n'         -F audio=@speech.pcm -F format=pcm_s16le -F sample_rate=16000 -F session=t -F seq=6 $U/caption/chunk
curl -s -o /dev/null -w 'badauth→%{http_code}\n' -H "Authorization: Bearer wrong" -F audio=@speech.pcm -F format=pcm_s16le -F sample_rate=16000 -F session=t -F seq=7 $U/caption/chunk
for n in 1 2 3 4 5; do curl -s -o /dev/null -w "conc$n:%{http_code}\n" -H "$A" -F audio=@speech.pcm -F format=pcm_s16le -F sample_rate=16000 -F session=c -F seq=$n $U/caption/chunk & done; wait
```
Expected: WAV/PCM `200`+text; silence `200 no_speech:true`; webm `415`; big `413`; noauth/badauth `401`;
concurrency burst yields at least one `503`.

### 3.8 Privacy tests
```bash
docker compose logs stt | grep caption_chunk   # metadata only: session/seq/format/duration_ms/latency_ms/status
docker compose logs stt | grep -i "live captions test" && echo "FAIL: transcript leaked" || echo "OK: no transcript in logs"
docker compose exec stt sh -lc 'find / -xdev -type f \( -name "*.wav" -o -name "*.pcm" -o -name "*.audio" -o -name "*.ogg" \) 2>/dev/null | grep -v /root/.cache || echo "OK: no audio persisted"'
```

### 3.9 Latency capture
Record: **cold load** (up → first `ready:true`), **first decode**, **warm decode**, **silence**
(from `%{time_total}`). Targets in §6.

### 3.10 Teardown
```bash
docker compose down            # keep model cache volume
# docker compose down -v       # also drop model cache
unset STT_API_KEY WHISPER_MODEL
rm -f speech.wav speech.pcm silence.pcm big.pcm /tmp/raw.wav
```

---

## 4. Production deployment architecture

- **Private network only.** The appliance binds inside a private VPC/subnet. **No public,
  unauthenticated endpoint.** Only the Mondaily API egress (or the browser-direct scoped-token path,
  if ever adopted) reaches it. Bind to `127.0.0.1`/private IP; never `0.0.0.0` on a public interface.
- **Reverse proxy** (nginx/Caddy/Traefik) terminates TLS, enforces body-size limits (defense-in-depth
  vs the app's 413), sets sane timeouts, and forwards only `/caption/chunk`, `/health`, `/ready`,
  `/transcribe`. Proxy does **not** log request bodies.
- **Bearer auth** — `STT_API_KEY` set (fail-closed 401). Rotate periodically; store as a secret, never
  in the image or compose file committed to git.
- **Metadata-only logs** — enforced by the app (`session/seq/format/duration_ms/latency_ms/status`).
  Ship logs to your aggregator with the same guarantee; never enable body logging at the proxy.
- **No audio/transcript persistence from live chunks** — chunks decode in-memory and are discarded;
  responses are not stored appliance-side. (Batch `/transcribe` uses a short-lived temp file it deletes;
  live captions never touch disk.)
- **Rate limits / concurrency** — `STT_MAX_CONCURRENCY` per container (default 2; raise on GPU);
  `STT_MAX_CHUNK_BYTES` (10 MB) and `STT_CHUNK_TIMEOUT_S` (15 s) guard payload/hang. Add a proxy-level
  rate limit per client. Scale out with multiple single-worker containers behind the proxy rather than
  `--workers N` (keeps the per-process concurrency gauge honest).
- **Health/readiness monitoring** — probe `GET /ready` (200 = model resident + free slot; 503 =
  loading/overloaded) for load-balancer membership; alert on sustained 503 or `/health` unreachable.
- **Restart policy** — `restart: unless-stopped` (already in compose); orchestrator restarts on crash;
  readiness gates traffic until the model reloads.
- **Model cache** — the HF model lives on the `whisper-cache` volume so restarts don't re-download.
  Back it up or pre-warm on new hosts to avoid cold-boot download time.
- **Disk usage monitoring** — alert on volume growth; the cache is bounded per model, but monitor for
  unexpected temp growth (should be ~0 for live chunks).
- **Rollback** — pin the appliance image by digest/tag; keep the previous image; roll back by
  redeploying the prior tag. Config/model changes are env-only, so rollback is a redeploy, not a
  rebuild. The Mondaily side rolls back instantly by **unsetting `SOVEREIGN_STT_CHUNK_URL`** — which
  flips `liveCaptionsAvailable()` false and the UI back to the honest "unavailable" state.

---

## 5. Go / No-Go gates

All must pass (Tier A for staging approval; Tier B additionally for production rollout):

| Gate | Required |
|---|---|
| Docker build with **exact pins** | completes; no pip resolver conflict |
| numpy-2 ABI import | `import numpy,ctranslate2,onnxruntime,av,faster_whisper` OK |
| `/health` + `/ready` | `ready:true`, `concurrency.max==2` (or configured) |
| Real speech (WAV + PCM) | `200`, correct `text`, full contract shape |
| Silence | `200`, `no_speech:true` |
| Invalid codec | `415` |
| Oversized (>10 MB) | `413` |
| Missing/bad auth | `401` |
| Concurrency overload | at least one `503` |
| Timeout safety | slow decode → `504` (unit-tested; observe under real load if possible) |
| Logs | metadata-only; **no transcript text**, **no audio bytes** |
| Disk | no audio files persisted (only model cache) |
| Latency | acceptable for chosen model/hardware (§6) |
| Endpoint exposure | private + authenticated; no public unauth path |

### 6. Latency targets
- **Tier A (CPU `base.en`):** warm decode ≤ ~1.5 s for a ~3 s chunk (baseline; not production SLA).
- **Tier B (GPU `distil-large-v3` on L4):** warm decode comfortably **< chunk duration** (e.g. ≤ ~0.5–0.8 s
  for a 2–3 s chunk) so captions keep up in real time; p95 ≤ 800 ms at target concurrency.
- Silence should short-circuit to tens of ms on any tier.

---

## 7. Explicit policy statements

- **Mac validation is NOT required** and is not a gate. Linux appliance only.
- **Tier A (CPU) validation is sufficient to approve Phase 2 _staging_ wiring** behind
  `SOVEREIGN_STT_CHUNK_URL`.
- **Tier B (GPU) validation is REQUIRED before production live-caption rollout.**
- **Phase 2 must be staging/canary only** — set `SOVEREIGN_STT_CHUNK_URL` (+ `SOVEREIGN_STT_KEY`) in
  **staging first**, canary a subset, and verify honest behavior before any production enablement.
- **No fake captions, ever.** When STT is unavailable/misconfigured/overloaded, the UI shows the honest
  "unavailable"/"paused" state — it never invents caption text. This is a hard invariant across all
  tiers and rollouts.

---

## 8. Path forward

1. Stand up a Tier-A Ubuntu VM → run §3 → fill the §5 table.
2. If all Tier-A gates pass → approve **Phase 2 staging** wiring (separate task; app/API changes).
3. Before production → stand up Tier-B GPU host → re-run §3 with the production model → confirm §6
   latency + accuracy → approve production rollout (canary first).
