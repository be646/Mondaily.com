# STT Appliance — Docker Runtime Validation Runbook (Phase 1.3)

> **Purpose:** prove the committed `/caption/chunk` appliance runs correctly inside its real Docker
> image with the **pinned** `requirements.txt` and a **real Whisper model** — the last gate before
> Mondaily Phase 2 (staging-only call-room audio chunking behind `SOVEREIGN_STT_CHUNK_URL`).
>
> **Run this on a Docker-capable host.** It changes no Mondaily app/API/env. It does NOT set
> `SOVEREIGN_STT_CHUNK_URL` and does NOT wire the call room. When every row of the §9 pass/fail table
> is ✅, Phase 2 wiring is allowed. If anything fails, **do not wire the app** — report the failure.
>
> Contract reference: [`LIVE_CAPTIONS_STT_CONTRACT.md`](./LIVE_CAPTIONS_STT_CONTRACT.md).
> The endpoint code + real-model behavior were already proven outside Docker (Phase 1.2); this run
> confirms the **exact pinned deps** resolve/run under `python:3.11-slim`.

---

## 1. Preconditions

- Docker + Docker Compose v2 installed (`docker --version`, `docker compose version`).
- Run from the appliance dir: `cd deploy/stt-appliance`.
- Image base is `python:3.11-slim` (already set in `stt/Dockerfile`) — required so `numpy==2.2.1`
  (needs Python ≥3.10) installs.
- **`STT_API_KEY` is required** for this run (we test auth). Pick any secret for the session.
- `WHISPER_MODEL` suggestions:
  - `tiny.en` — fastest validation (smallest download, ~1 s warm decode on CPU).
  - `base.en` — CPU pilot quality/latency balance.
  - `distil-large-v3` (or `large-v3`) — GPU later; use the GPU image variant and
    `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE=float16` (see `README.md`).
- Single uvicorn worker only. The concurrency gauge (`_active`) and `/health`·`/ready` are
  per-process — do **not** add `--workers N` without a shared limiter.

```bash
export STT_API_KEY="$(openssl rand -hex 16)"   # session secret
export WHISPER_MODEL=tiny.en                    # or base.en
echo "key set; model=$WHISPER_MODEL"
```

---

## 2. Build & run

`docker-compose.yml` forwards `STT_API_KEY` and `WHISPER_MODEL`. It does **not** forward
`STT_MAX_CONCURRENCY`, but the appliance **defaults `MAX_CONCURRENCY=2`** — exactly the value we want,
so no change is needed. To make it explicit, pass it inline as shown.

```bash
# Build the image (installs pinned requirements.txt) and start detached.
STT_API_KEY="$STT_API_KEY" WHISPER_MODEL="$WHISPER_MODEL" \
  docker compose up -d --build

# (optional) make concurrency explicit — default is already 2:
#   add under services.stt.environment in a compose override, or run the container directly:
#   docker run -e STT_API_KEY -e WHISPER_MODEL -e STT_MAX_CONCURRENCY=2 -p 8090:8090 <image>

docker compose ps          # stt should be "running"
docker compose logs -f stt # watch until "Application startup complete" (model finishes downloading)
```

**Cold-load note:** first boot downloads the model from HuggingFace, so `/health` won't answer until
the model is resident (eager load happens before uvicorn binds). Time this window (§8).

---

## 3. Dependency proof (exact pins)

```bash
docker compose exec stt python --version        # expect: Python 3.11.x
docker compose exec stt pip freeze | grep -Ei '^(numpy|faster-whisper|ctranslate2|onnxruntime|av|python-multipart|anyio|fastapi|uvicorn|httpx)=='
```

**Must show exactly:**
```
numpy==2.2.1
faster-whisper==1.1.1
python-multipart==0.0.20
anyio==4.12.1
fastapi==0.115.6
uvicorn==0.34.0
httpx==0.28.1
```
`ctranslate2` (>=4.0,<5), `onnxruntime` (>=1.14,<2), `av` (>=11) resolve transitively — record their
versions. **Key check:** `numpy==2.2.1` co-installed with `faster-whisper==1.1.1` with no pip conflict
(faster-whisper imposes no numpy upper bound; onnxruntime needs `numpy>=1.21.6`). If `pip` reported a
resolver conflict during build, the build already failed — capture it (§11).

**numpy-2 ABI sanity** (the one thing static analysis can't prove) — imports must succeed under numpy 2:
```bash
docker compose exec stt python -c "import numpy, ctranslate2, onnxruntime, av, faster_whisper; print('imports OK', numpy.__version__)"
```

---

## 4. Health / readiness

```bash
curl -s localhost:8090/health | tee /dev/stderr | python3 -m json.tool
curl -s localhost:8090/ready  | python3 -m json.tool
```

**Expected `/health`:**
```json
{ "ok": true, "model": "tiny.en", "device": "cpu", "ready": true,
  "concurrency": { "active": 0, "max": 2 } }
```
**Expected `/ready`:** `200` with `{"ready": true, ..., "concurrency": {"active": 0, "max": 2}}`.

- `ready:true` only after the model is loaded; `concurrency.max` must equal `2`, `active` `0` at rest.
- `/ready` returns `503` when the model is still loading or all slots are busy (verified in §6 overload).

---

## 5. Audio sample generation

You need three 16 kHz-mono samples: `speech.wav`, `speech.pcm` (raw s16le), `silence.pcm`.

### macOS (built-in `say` — no network)
```bash
say -o speech.wav --data-format=LEI16@16000 "hello this is a live captions test for mondaily"
python3 - <<'PY'
import wave, numpy as np
with wave.open("speech.wav","rb") as w: open("speech.pcm","wb").write(w.readframes(w.getnframes()))
open("silence.pcm","wb").write(np.zeros(2*16000, dtype='<i2').tobytes())
print("wrote speech.pcm, silence.pcm")
PY
```

### Linux (ffmpeg fallback — synth or record)
```bash
# If you have any speech file (e.g. sample.mp3), transcode to 16k mono WAV:
ffmpeg -y -i sample.mp3 -ac 1 -ar 16000 -acodec pcm_s16le speech.wav
# raw PCM (strip WAV header) + a 2s silence PCM:
ffmpeg -y -i speech.wav -f s16le -ac 1 -ar 16000 speech.pcm
python3 -c "import numpy as np; open('silence.pcm','wb').write(np.zeros(2*16000,dtype='<i2').tobytes())"
```
> No speech file handy? Use any TTS (`espeak -w speech_raw.wav "..."; ffmpeg -i speech_raw.wav -ac 1 -ar 16000 -acodec pcm_s16le speech.wav`). A pure tone won't validate transcription — use real words.

### Oversized payload (for the 413 test)
```bash
head -c 11000000 /dev/zero > big.pcm    # 11 MB > 10 MB cap
```

---

## 6. `/caption/chunk` checks

```bash
U=localhost:8090; A="Authorization: Bearer $STT_API_KEY"

echo "1) WAV speech";      curl -s -w '\n[%{http_code} %{time_total}s]\n' -H "$A" -F audio=@speech.wav  -F format=wav        -F sample_rate=0     -F session=t -F seq=1 $U/caption/chunk
echo "2) PCM speech";      curl -s -w '\n[%{http_code} %{time_total}s]\n' -H "$A" -F audio=@speech.pcm  -F format=pcm_s16le  -F sample_rate=16000 -F session=t -F seq=2 $U/caption/chunk
echo "3) silence";         curl -s -w '\n[%{http_code} %{time_total}s]\n' -H "$A" -F audio=@silence.pcm -F format=pcm_s16le  -F sample_rate=16000 -F session=t -F seq=3 $U/caption/chunk
echo "4) webm_opus →415";  curl -s -o /dev/null -w '[%{http_code}]\n'      -H "$A" -F audio=@speech.pcm  -F format=webm_opus  -F session=t -F seq=4 $U/caption/chunk
echo "5) oversized →413";  curl -s -o /dev/null -w '[%{http_code}]\n'      -H "$A" -F audio=@big.pcm     -F format=pcm_s16le  -F sample_rate=16000 -F session=t -F seq=5 $U/caption/chunk
echo "6) no auth →401";    curl -s -o /dev/null -w '[%{http_code}]\n'              -F audio=@speech.pcm  -F format=pcm_s16le  -F sample_rate=16000 -F session=t -F seq=6 $U/caption/chunk
echo "7) bad auth →401";   curl -s -o /dev/null -w '[%{http_code}]\n' -H "Authorization: Bearer wrong" -F audio=@speech.pcm -F format=pcm_s16le -F sample_rate=16000 -F session=t -F seq=7 $U/caption/chunk

echo "8) overload →some 503 (max=2)"
for n in 1 2 3 4 5; do
  curl -s -o /dev/null -w "  req$n:%{http_code}\n" -H "$A" -F audio=@speech.pcm -F format=pcm_s16le -F sample_rate=16000 -F session=c -F seq=$n $U/caption/chunk &
done; wait
```

**Expected:**
- (1)(2) `200` with a non-empty `text` matching the spoken words; full shape
  `{text, final, language, confidence, duration_ms, seq, no_speech}`, `no_speech:false`.
- (3) `200` `{ "text":"", "no_speech":true, "confidence":null }`.
- (4) `415`  (5) `413`  (6) `401`  (7) `401`.
- (8) at least one `200` and at least one `503` (with `max=2`, expect ~2×200 + ~3×503).

---

## 7. Privacy checks

```bash
docker compose logs stt | grep caption_chunk
```
**Expected — metadata only**, e.g.:
```
caption_chunk session=t seq=1 format=wav       duration_ms=2903 latency_ms=1009 status=ok
caption_chunk session=t seq=3 format=pcm_s16le duration_ms=2000 latency_ms=21   status=no_speech
```
Then confirm the transcript text NEVER appears and no audio was persisted:
```bash
# transcript text must NOT be in logs (use words from your sample):
docker compose logs stt | grep -i "live captions test" && echo "FAIL: transcript leaked" || echo "OK: no transcript text in logs"
# no audio files inside the container (only the HF model cache is expected):
docker compose exec stt sh -lc 'find / -xdev -type f \( -name "*.wav" -o -name "*.pcm" -o -name "*.audio" -o -name "*.ogg" \) 2>/dev/null | grep -v /root/.cache || echo "OK: no audio files persisted"'
```

---

## 8. Latency capture

Record from the `%{time_total}` values (§6) and the boot log:
- **Cold load** — wall time from `docker compose up` to first `ready:true` (model download + load).
- **First decode** — `time_total` of the first `/caption/chunk` speech call (cold, higher).
- **Warm decode** — `time_total` of a subsequent speech call.
- **Silence** — `time_total` of the silence call (VAD short-circuits, should be tens of ms).

Reference (Phase 1.2, CPU `tiny.en`, ~2.9 s audio, non-Docker): cold ~8 s, first ~2.5 s, warm ~1.0 s,
silence ~21 ms. Your numbers vary by model/host — `base.en` and GPU differ; capture actuals.

---

## 9. Pass/fail gate (ALL must be ✅ before Phase 2 app wiring)

| # | Check | Required result |
|---|---|---|
| 1 | Docker build | completes; no pip resolver conflict |
| 2 | `python --version` | `3.11.x` |
| 3 | pinned deps | `numpy==2.2.1`, `faster-whisper==1.1.1`, `python-multipart==0.0.20`, `anyio==4.12.1` present |
| 4 | numpy-2 ABI import | `import numpy, ctranslate2, onnxruntime, av, faster_whisper` succeeds |
| 5 | `/health` | `ok:true`, `ready:true`, `concurrency.max==2` |
| 6 | `/ready` | `200`, `ready:true` |
| 7 | WAV speech | `200`, non-empty `text`, correct shape |
| 8 | PCM speech | `200`, non-empty `text` |
| 9 | silence | `200`, `no_speech:true` |
| 10 | webm_opus | `415` |
| 11 | oversized >10 MB | `413` |
| 12 | missing auth | `401` |
| 13 | bad auth | `401` |
| 14 | overload burst | at least one `503` |
| 15 | logs | metadata-only; **no transcript text** |
| 16 | disk | no audio files persisted (only model cache) |
| 17 | latency | warm decode acceptable for target model (e.g. ≤ ~1.5 s CPU `base.en`) |

---

## 10. Teardown

```bash
docker compose down                 # stop + remove container (model cache volume persists)
# docker compose down -v            # also drop the model cache volume, if you want a clean slate
unset STT_API_KEY WHISPER_MODEL
rm -f speech.wav speech.pcm silence.pcm big.pcm
```

---

## 11. Final note

- **If every §9 row is ✅:** Mondaily is READY for **Phase 2 — staging-only** call-room audio chunking
  behind `SOVEREIGN_STT_CHUNK_URL`. Set `SOVEREIGN_STT_CHUNK_URL` + `SOVEREIGN_STT_KEY` in **staging**
  first (this flips `liveCaptionsAvailable()` true there), then build the app-side capture/proxy.
- **If anything fails:** do **not** wire the app. Capture and report the exact failure:
  - build/resolver error → the full `docker compose build` output (esp. any `pip` conflict line);
  - import/ABI error → the traceback from the §3 import check;
  - endpoint mismatch → the offending request + actual status/body;
  - privacy failure → the log line that leaked text or the persisted audio path.
