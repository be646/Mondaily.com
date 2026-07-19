# Sovereign Live STT — Live Captions Contract (Phase 0 design)

> **Status: INERT SPEC. Nothing here is implemented yet.**
> This document defines the interface a future sovereign live-STT endpoint must satisfy to
> power Mondaily live captions. It changes no runtime code, adds no environment variables, and
> implements no appliance endpoint. Building any of it is **Phase 2+** and requires an explicit
> go-ahead (see the Go/No-Go checklist).

---

## 0. Where this fits

Live Captions **Phase 1 already shipped** (commit `d132175f`) as an honest scaffold with **no real STT**:

- Caption packet contract + safe parser — `packages/shared/src/captions.ts`
  (`{ t:"caption", id, participantId, name, text, final, ts }`).
- Capability flag `live_captions_available` surfaced on the calendar event view and guest `/meta`,
  driven by `liveCaptionsAvailable()` in `packages/api/src/lib/livekit.ts`.
- CC toggle + `CaptionsPanel` in both the host room (`call-room.tsx`) and guest room (`guest-call.tsx`),
  reading caption packets off the LiveKit data channel (ephemeral, room-scoped, guest-safe).
- **No fake captions**, no audio chunking, no caption endpoint, no persistence. Post-call Meeting
  Memory remains the single source of truth.

Because no live/chunk STT endpoint exists, `live_captions_available` is **false in production** and the
UI honestly shows "Live captions unavailable". This spec defines the endpoint that flips it true.

---

## 1. Audit of the current (batch) STT

**Client** — `packages/api/src/lib/livekit.ts`:

- `transcriptionEnabled()` → `!!SOVEREIGN_STT_URL` (batch only).
- `transcribeAudio(audioUrl)` → `POST {SOVEREIGN_STT_URL}/transcribe` with JSON
  `{ audio_url, diarize: true }` and optional `Authorization: Bearer ${SOVEREIGN_STT_KEY}`.
  Returns `null` on any failure; `mapSttResponse()` normalizes to `TranscriptLine[] {speaker,text,start_time}`.
- `liveCaptionsAvailable()` → `!!(SOVEREIGN_STT_STREAM_URL || SOVEREIGN_STT_CHUNK_URL)`.
  **The env hooks already exist but point at nothing.**

**Appliance** — `deploy/stt-appliance/`: FastAPI + `faster-whisper==1.1.1`,
`WhisperModel(WHISPER_MODEL=small, device=cpu, compute=int8)`. Endpoints:
`POST /transcribe` (downloads `audio_url`, `vad_filter=True`) and `GET /health → {ok,model,device}`.
Auth: optional `Bearer STT_API_KEY`. SSRF-guarded `_validate_url` + `STT_ALLOWED_HOSTS`.

### Why batch `/transcribe` cannot power live captions

The batch endpoint requires a **fully-uploaded file at a fetchable URL** and returns a single blob
**after decoding the whole file** — it is inherently post-hoc. Live captions need
sub-second-to-few-second turnaround on audio that is **still being spoken**. Batch is correct for
post-call Meeting Memory and must stay unchanged; it is the wrong tool for captions.

### Architectural asset: self-captioning removes diarization

Phase 1 uses **per-participant self-captioning** — each client captions *its own* microphone and
publishes a `CaptionPacket` whose `participantId` is the publisher. The speaker is therefore always
known, so **the live-STT endpoint needs mic→text only, not speaker separation.**

---

## 2. Recommendation: chunk endpoint first

Build the **HTTP chunk endpoint (`SOVEREIGN_STT_CHUNK_URL`) for Phase 2.**
Defer the **WebSocket streaming endpoint (`SOVEREIGN_STT_STREAM_URL`) to Phase 3.**

| | Chunk (HTTP) — **recommend P2** | Stream (WebSocket) — **defer P3** |
|---|---|---|
| Infra fit | Request/response — proxies cleanly through the existing Hono/Vercel API | Persistent socket — Vercel serverless can't hold WS; forces browser↔appliance direct |
| Sovereign key | Stays server-side (proxied) | Browser needs a scoped token or the key leaks |
| Latency | chunk_dur + ~0.3–0.8 s (≈2.5–3.5 s behind live) | ~0.3–0.6 s true partials |
| Complexity | Low — one POST per 2–3 s | High — session state, backpressure, reconnects |
| GPU need | Optional (CPU `base.en` at low volume) | Effectively requires GPU for partials |

Captions at ~3 s latency are acceptable; WS complexity and the "no WS through Vercel" constraint are
not worth it until GPU + real volume justify them. **Chunk-first.**

**Recommended data path:** browser AudioWorklet → **Mondaily API proxy route** →
`SOVEREIGN_STT_CHUNK_URL` → text back → browser publishes a `CaptionPacket` on the LiveKit data channel.
Proxying keeps `SOVEREIGN_STT_KEY` server-side, keeps the appliance private, and reuses existing
workspace/guest auth. Escape hatch for scale: browser-direct with a short-lived, session-scoped token.

---

## 3. Accepted audio formats

**Canonical wire format: PCM `s16le`, mono, 16 kHz.**

- Whisper natively wants 16 kHz mono; PCM needs no container.
- **The webm/opus trap:** `MediaRecorder.start(timeslice)` emits fragments where **only the first
  carries the container header** — later fragments are not independently decodable. Per-chunk webm
  decoding fails unless the recorder is stopped/restarted each chunk (introduces gaps). Avoid.
- Capture via **AudioWorklet** (Float32 → Int16); send fixed-size PCM frames. Sovereign, gap-free,
  identical for chunk and future stream.

Declared per request via `format`:

- `pcm_s16le` — canonical; `sample_rate` required (expect 16000).
- `wav` — standalone RIFF, self-describing.
- `webm_opus` — accepted **only as standalone blobs** (stop/restart pattern); convenience, not recommended.

The appliance resamples anything ≠ 16 kHz.

---

## 4. Exact contract — chunk endpoint

```
POST  {SOVEREIGN_STT_CHUNK_URL}/caption/chunk
Authorization: Bearer <SOVEREIGN_STT_KEY>
Content-Type: multipart/form-data
```

Multipart fields (raw bytes, no base64 bloat):

| field | type | notes |
|---|---|---|
| `audio` | binary | one chunk, ~1–3 s |
| `format` | string | `pcm_s16le` \| `wav` \| `webm_opus` |
| `sample_rate` | int | required for `pcm_s16le` (e.g. 16000) |
| `session` | string | opaque room/session id — **metadata only, never logged with text** |
| `seq` | int | monotonic chunk index per session |
| `language` | string? | optional hint (`en`); else auto-detect |
| `final` | bool? | client signals last chunk of an utterance |

### Response `200`

```json
{
  "text": "so what I'm proposing is",
  "final": false,
  "language": "en",
  "confidence": 0.82,
  "duration_ms": 3000,
  "seq": 7,
  "no_speech": false
}
```

- `confidence`: avg-logprob mapped to 0–1 if the model exposes it, else `null`.
- Silence → `200 { "text": "", "no_speech": true, ... }` (not an error).
- The appliance MAY keep a rolling per-`session` context window in memory to stabilize word
  boundaries; if stateless, the client sends short overlap. Any such state is in-memory, evicted on
  idle, **never persisted**.

Response maps 1:1 onto the Phase-1 `CaptionPacket`: `no_speech:true` → drop, otherwise publish with
`final` carried through and `participantId` = the local (self-captioning) participant.

### Future stream contract (Phase 3 — sketch only, do not build)

```
WS  {SOVEREIGN_STT_STREAM_URL}/caption/stream?session=<id>
    (auth via Sec-WebSocket-Protocol: bearer,<key>  OR first control frame)
→ client sends binary PCM frames (e.g. 20–100 ms)
← server sends JSON: {"t":"partial"|"final","text":"...","seq":N,"ts":...,"confidence":...,"no_speech":false}
    close codes: 1008 unauthorized, 1011 overloaded, 1003 unsupported_format
```

`partial → final:false`, `final → final:true` — same `CaptionPacket` render path.

---

## 5. Error codes

| HTTP | `code` | Meaning | Client action |
|---|---|---|---|
| 200 | — (`no_speech:true`) | silence | render nothing |
| 400 | `bad_request` | missing/invalid fields | drop chunk, log |
| 401 | `unauthorized` | bad/missing bearer | fail-closed, disable captions |
| 413 | `payload_too_large` | chunk over cap | shrink timeslice |
| 415 | `unsupported_media_type` | unknown `format`/codec | fall back to PCM |
| 422 | `no_audio` | empty/corrupt buffer | skip |
| 429 | `rate_limited` | per-session/global cap | backoff |
| 503 | `overloaded` / `model_loading` | GPU/CPU saturated or warming | backoff, show "captions paused" |
| 504 | `timeout` | decode exceeded budget | drop chunk, continue |

Always JSON `{ "error": "<human>", "code": "<machine>" }`. Never 200-with-error.

### Failure modes

- **No speech** → `200 {no_speech:true, text:""}`.
- **Noisy audio** → best-effort text with lower `confidence`; client may hide low-confidence partials.
- **Timeout** → `504`, drop that chunk, keep going (captions degrade, never block the call).
- **Unsupported codec** → `415`; client falls back to PCM.
- **Overloaded GPU/CPU** → `429`/`503` with backoff; UI shows an honest "captions paused" state.

---

## 6. Security model

- **No public unauthenticated endpoint.** Bearer `SOVEREIGN_STT_KEY` required, plus
  private-network / firewall-to-API-egress. Browser never holds the key on the proxied path; a
  browser-direct path (if ever used) gets a short-lived, session-scoped, single-purpose token — never
  the master key.
- **No third-party STT, no browser Web Speech API** — faster-whisper on Mondaily-owned hardware only.
- **No transcript persistence at the appliance.** Text exists only in the response body.
- **No raw audio logs, no audio on disk.** Decode in memory (tmpfs if any spill), discard immediately.
- **Metadata-only logs:** `{session, seq, duration_ms, latency_ms, status, model}` — never `text`,
  never audio bytes.
- **Consent:** live-caption capture reuses the **existing recording-consent gate**; capture starts
  only when consent is in force and the user opts in, and both host and guests see the notice.
  (Phase 2 app wiring — not built here.)

---

## 7. Deployment / hardware

- **MVP (CPU, low volume):** 4 vCPU / 8 GB, `faster-whisper base.en` (or `tiny.en` for lowest
  latency), int8, silero VAD. A couple of concurrent low-latency streams. Extends the current compose.
- **Production (GPU, scale):** NVIDIA **T4 (16 GB)** or **L4 (24 GB)**; model
  **`distil-whisper large-v3`** (fast + accurate, English) or `small`/`medium` for multilingual,
  float16, batched. GPU unlocks multi-participant and eventual streaming partials.
- **Model path:** start `base.en`/`small.en` on CPU for the pilot; move to `distil-large-v3` on L4
  when captions leave beta.
- **Runtime outline:** add a `/caption/chunk` route to the existing FastAPI app; keep the model
  resident; add a concurrency semaphore returning `429`/`503` when saturated; expose `/health` +
  `/ready` reporting `{active,max}` decode slots. Docker: reuse `deploy/stt-appliance/`, GPU variant
  adds `--gpus all` + CUDA base. compose/systemd: `restart: unless-stopped`, healthcheck on `/health`,
  tmpfs scratch, no audio volume (model cache only).

### Mondaily environment variables needed later (do NOT add now)

| var | purpose |
|---|---|
| `SOVEREIGN_STT_CHUNK_URL` | base URL of the chunk endpoint — flips `liveCaptionsAvailable()` true (Phase 2) |
| `SOVEREIGN_STT_STREAM_URL` | base URL of the WebSocket streaming endpoint (Phase 3) |
| `SOVEREIGN_STT_KEY` | bearer secret; may reuse the existing batch key |

`liveCaptionsAvailable()` already reads the first two — setting either activates the capability flag.

---

## 8. Acceptance tests (for when the appliance is built)

1. Real 4 s speech chunk → non-empty `text`, `no_speech:false`.
2. 4 s silence → `200 {text:"", no_speech:true}`.
3. Invalid/garbage codec → `415 unsupported_media_type`, no crash.
4. N concurrent chunks (N = target participants) all succeed within budget; N+1 → `429`/`503`.
5. **p95 latency** ≤ 800 ms for a 3 s PCM chunk on target hardware (ideal ≤ 400 ms).
6. **No retained audio:** after a run, no audio files on disk; logs contain zero transcript text.
7. `GET /health` → `{ok:true, ready:true, model, device, concurrency:{active,max}}`.
8. Missing/incorrect bearer → `401`; appliance stays private.

---

## 9. What NOT to build yet

- No appliance `/caption/chunk` (or `/caption/stream`) implementation.
- No Mondaily API proxy route.
- No app capture (AudioWorklet), no chunk upload, no live publish wiring.
- No new environment variables in Vercel.
- No changes to `call-room.tsx` / `guest-call.tsx` behavior beyond the Phase-1 scaffold.
- No changes to batch `/transcribe`, Meeting Memory, or prompts.
- No WebSocket streaming (Phase 3).

### Mondaily changes that come AFTER this (deferred)

1. **Appliance:** add `/caption/chunk` (+ later `/caption/stream`), concurrency guard,
   metadata-only logging.
2. **API:** authenticated, workspace-scoped, rate-limited proxy route
   (e.g. `POST /api/v1/calls/caption-chunk`) forwarding bytes → `SOVEREIGN_STT_CHUNK_URL`, returning
   `{text,final,no_speech}`; **fail-closed when `!liveCaptionsAvailable()`**. Guest-safe twin under
   `/public/calls/caption-chunk` (token-scoped) so guests never touch authenticated APIs.
3. **App:** opt-in AudioWorklet PCM capture when
   `live_captions_available && CC enabled && consent in force`; POST chunks to the proxy; publish
   `CaptionPacket` (self-captioning) over the existing data channel — the Phase-1 render path already
   handles it.

---

## 10. Risks & cost

- **webm fragmentation pitfall** — mitigated by PCM/AudioWorklet.
- **Per-chunk API invocation cost** on Vercel — mitigate with ~2–3 s chunks; browser-direct escape hatch.
- **GPU cost** ≈ $0.4–1.0/hr (T4/L4) when active; CPU is cheap but caps concurrency/latency.
- **Client CPU/battery** for AudioWorklet capture (small, real on mobile).
- **Concurrency saturation** → captions degrade; must fail-soft to "paused", never fake.
- **Multilingual accuracy** below English with distil models; choose model per audience.
- **Privacy/consent** surface expands — audio leaves the client mid-call (to Mondaily's own appliance
  only); consent copy must be explicit.

---

## 11. Go / No-Go checklist (entry criteria for Phase 2 build)

- [ ] Appliance host provisioned (CPU MVP or GPU) with `/caption/chunk` implemented to this contract.
- [ ] `/health` + `/ready` return concurrency slots; load-tested at target participant count.
- [ ] Acceptance tests 1–8 pass on that host.
- [ ] `SOVEREIGN_STT_CHUNK_URL` + `SOVEREIGN_STT_KEY` set in Vercel (flips `liveCaptionsAvailable()` true).
- [ ] Metadata-only logging verified (logs: zero transcript text, zero audio).
- [ ] Consent copy reviewed for "audio sent to Mondaily's own STT during captions".
- [ ] p95 latency ≤ 800 ms confirmed on prod hardware.

---

**One-line recommendation:** build a **PCM-16k, multipart HTTP chunk endpoint**
(`SOVEREIGN_STT_CHUNK_URL`) proxied through the Mondaily API, keep diarization out (self-captioning
already solves it), and hold WebSocket streaming for Phase 3 once GPU is in place.
