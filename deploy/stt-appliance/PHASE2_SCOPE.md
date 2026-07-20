# Live Captions Phase 2 — Scope (staging-only call-room audio chunking)

> **Design/scope doc. No code, no env, no wiring.** This defines the safest way to connect Mondaily
> live calls to the Tier-A-validated STT appliance endpoint (`POST /caption/chunk`). Implementation is
> a separate, explicitly-approved task. Nothing here touches Meeting Memory, the post-call transcript
> pipeline, prompts, billing, records, private inference, or production Vercel env.
>
> Next on the calls roadmap (audit-only spec): live readable transcript + multilingual translation +
> saved transcript → [`LIVE_TRANSCRIPT_TRANSLATION_SPEC.md`](./LIVE_TRANSCRIPT_TRANSLATION_SPEC.md).
>
> Prereqs already met: Phase 1 scaffold live (`d132175f`), appliance `/caption/chunk` implemented and
> **Tier-A Docker-validated** on real Linux. Companions:
> [`LIVE_CAPTIONS_STT_CONTRACT.md`](./LIVE_CAPTIONS_STT_CONTRACT.md),
> [`PRODUCTION_VALIDATION.md`](./PRODUCTION_VALIDATION.md).

---

## 1. Audit findings (from the real code)

- **Member call room** (`apps/app/src/routes/dashboard/call-room.tsx`) already publishes and receives
  LiveKit data: `localParticipant.publishData(...)` (chat/hand raise) and a `RoomEvent.DataReceived`
  handler that **already parses `CaptionPacket`** (Phase 1). Its LiveKit token is minted in
  `packages/api/src/routes/calendar.ts` / `live-calls.ts` with **`canPublishData:true` + `canSubscribe:true`**.
- **Guest call room** (`apps/app/src/routes/guest-call.tsx`) uses the guest-token flow: token from the
  URL fragment `#g=` → redeemed at `POST /public/calls/token` → guest LiveKit token minted in
  `packages/api/src/routes/guest-calls.ts` with **`canPublishData:true`** (roomJoin only, never
  roomAdmin). The guest page calls **only `/api/v1/public/calls/*`** — never authenticated workspace APIs.
- **CaptionPacket parser + render scaffold exists** — `packages/shared/src/captions.ts`
  (`parseCaptionPacket`) plus the shared `CaptionsPanel` in `call-tiles.tsx`, wired into both rooms.
- **`liveCaptionsAvailable()` env gate exists** — `packages/api/src/lib/livekit.ts`, true only when
  `SOVEREIGN_STT_CHUNK_URL` or `SOVEREIGN_STT_STREAM_URL` is set; surfaced as `live_captions_available`
  on the member event view and guest `/meta`.
- **Server-side STT key pattern exists** — `SOVEREIGN_STT_KEY` is only ever sent as a Bearer header to
  the appliance from the API (`livekit.ts`); it never reaches the browser. Public call routes already
  use `rateLimit(...)` + zod validation + token redemption + consent gating.

**Consequence:** both host and guest can already publish/receive data packets and render captions.
Phase 2 only needs to **produce** caption packets from local mic audio — no new transport, no grant
changes, no new render path.

---

## 2. Final architecture (Option A — proxy)

```
[local mic MediaStreamTrack]
        │  AudioWorklet: Float32 → PCM s16le mono 16 kHz, buffer ~2–3 s
        ▼
  browser POSTs chunk (multipart) ──► Mondaily API proxy route
                                        │  adds Bearer SOVEREIGN_STT_KEY (server-side)
                                        ▼
                                 SOVEREIGN_STT_CHUNK_URL  (validated /caption/chunk)
                                        │  { text, no_speech }
                                        ▼
  browser publishes CaptionPacket ──► LiveKit data channel ──► every participant
        (self-captioning: participantId = local identity)        renders via existing CaptionsPanel
```

- **Capture:** tap **only the local participant's mic** track; AudioWorklet downsamples to the
  appliance's canonical **PCM s16le mono 16 kHz** (not `MediaRecorder`/webm — the fragmentation trap).
- **Chunk:** ~2–3 s buffers, posted while CC is enabled + consent is in force.
- **Proxy:** API forwards raw bytes to `SOVEREIGN_STT_CHUNK_URL` with the server-side bearer; returns
  `{text, no_speech}` only.
- **Distribute:** on a non-empty result, the **same client** publishes a `CaptionPacket`
  (`participantId` = self) over the data channel; all participants render it via the Phase-1 panel.
- **Invariants:** no audio stored, no captions persisted, no Web Speech API, no third-party STT, no
  fake captions.

---

## 3. Why Option A (proxy), not direct browser → appliance

| | **A — browser → API proxy → appliance** (chosen) | **B — browser → appliance direct** (rejected for P2) |
|---|---|---|
| STT key | stays **server-side**; never in browser | browser can't hold the master key → must mint short-lived scoped tokens |
| Appliance exposure | reachable only from the API; browser never talks to it | must be publicly reachable with per-request scoped-token validation |
| Auth reuse | reuses member session + guest token as-is | new token-minting + appliance-side token verification |
| Attack surface / CORS | minimal | larger (public appliance, CORS, token replay) |
| Cost | ~1 API invocation / 2–3 s / speaker (~96 KB PCM) — trivial at canary volume | fewer API hops, but at the cost of the above |

**Decision:** Option A for Phase 2 staging — strongest sovereignty/privacy posture, least new surface,
identical host/guest packet path. **Option C (hybrid):** keep B (browser-direct + scoped token) as a
documented **future scale lever** once GPU + real volume justify it; do not build it now.

---

## 4. Staging-only environment

| Var | Where | Why |
|---|---|---|
| `SOVEREIGN_STT_CHUNK_URL` | `mondaily-com-api` **Preview/Staging env only** | presence flips `liveCaptionsAvailable()` → true **in that environment only** |
| `SOVEREIGN_STT_KEY` | same (staging) | server-side bearer to the appliance; never in Production, never in the app bundle |
| `LIVE_CAPTIONS_WORKSPACES` | new canary allowlist (staging) | restrict captions to the internal test workspace even within staging |

**Production stays off** because `SOVEREIGN_STT_CHUNK_URL` is simply **not set** in the Production env →
`liveCaptionsAvailable()` false → UI shows "unavailable". **Instant rollback = unset the var.**

---

## 5. Honest network note

Strict **private-network-only** appliance access is **not realistic in Phase 2**: the Mondaily API runs
on **Vercel with non-static egress IPs**, so it can't reach an RFC-1918-isolated appliance. The
realistic posture — matching the existing search + batch-STT appliances — is:

- **Public IP + mandatory Bearer (`SOVEREIGN_STT_KEY`)**, fail-closed on bad/missing auth.
- **Optional coarse IP allowlist** at the appliance/reverse proxy where feasible.
- **Private network / Tailscale / VPC peering can come later** if/when the API moves to private infra;
  it is **not** a Phase 2 blocker. Do not claim private-network isolation that isn't in place.

---

## 6. Failure behavior (fail-closed; never invent text)

| Condition | Behavior |
|---|---|
| Env missing / not configured | `live_captions_available:false` → CC shows "unavailable" (Phase 1) |
| STT error (4xx/5xx) or timeout (504) | drop that chunk, publish **no** packet; optional transient "captions paused" chip |
| Appliance overloaded (503) | exponential backoff, pause capture briefly, resume |
| Silence (`no_speech`) | no caption packet |
| Network loss | stop posting, quiet retry with backoff; captions pause, call unaffected |
| **Any** | **never display invented/placeholder caption text** |

---

## 7. Privacy / security

- **Local mic only** — never another participant's audio, never video.
- **No STT key in the browser** — bearer added server-side by the proxy.
- **No browser Web Speech API. No third-party STT.**
- **No audio or caption persistence** — chunks decode in appliance memory; responses aren't stored;
  captions are ephemeral data-channel packets.
- **Metadata-only logs** on API + appliance (already proven): `session/seq/format/duration_ms/latency_ms/status`
  — never transcript text, never audio bytes.
- **Consent notice** — live captions are a *new* audio egress even when recording is off. Show an honest
  "Live captions on — your speech is transcribed by Mondaily's sovereign STT" indicator, reusing the
  recording-consent pattern. **Host and guest identical behavior;** guest stays on `/public/calls/*` only.

---

## 8. Files likely to change (implementation — NOT now)

- `packages/api/src/lib/livekit.ts` — server-side `captionChunk(bytes, meta)` proxy helper
  (POST → `SOVEREIGN_STT_CHUNK_URL`, Bearer `SOVEREIGN_STT_KEY`).
- `packages/api/src/routes/` — new authenticated `POST /api/v1/calls/caption-chunk` (member,
  workspace-scoped, rate-limited, canary-gated, fail-closed if `!liveCaptionsAvailable()`).
- `packages/api/src/routes/guest-calls.ts` — public `POST /public/calls/caption-chunk` twin
  (guest-token-gated, rate-limited, consent-gated).
- `apps/app/src/routes/dashboard/call-room.tsx` + `apps/app/src/routes/guest-call.tsx` — AudioWorklet
  capture, chunk POST, publish `CaptionPacket`, CC gating, consent notice, teardown.
- `apps/app/src/routes/dashboard/call-tiles.tsx` — shared capture hook (`CaptionsPanel` already exists).
- **new** AudioWorklet processor asset (PCM downsampler).
- `packages/shared/src/captions.ts` — optional chunk-encoding helper.
- Tests: new guard + API endpoint suites (see §9).

---

## 9. Tests / guards required

- Captions available **only** when `SOVEREIGN_STT_CHUNK_URL` configured (fail-closed).
- No fake captions (no synthesized-text path anywhere).
- No `webkitSpeechRecognition` / `SpeechRecognition` (source-scan guard on `apps/app`).
- No persistence (no DB/nodes writes in the caption path).
- **No raw STT key in the frontend bundle** (source-scan guard on `apps/app`).
- Host and guest publish/receive the **identical `CaptionPacket` shape**.
- Teardown: CC off / mic off / leave **stops chunking** (no orphan capture / worklet).
- API: member route requires session; guest route requires valid guest token + consent; both
  rate-limited; both return 4xx when `!liveCaptionsAvailable()`.

---

## 10. Rollout

1. **Staging/canary only** — set the §4 env in the staging API env; gate to the internal test
   workspace via `LIVE_CAPTIONS_WORKSPACES`.
2. **One internal test meeting** (host + guest): speak → confirm live captions appear for both;
   induce failures (stop appliance, bad chunk) → confirm honest "paused"/"unavailable", never invented
   text.
3. **No production** until **Tier B GPU validation** (L4 / `distil-large-v3`) proves real-time latency +
   accuracy. Production enablement is a later, separate decision.

---

## Verdict

Recommended Phase 2 = **Option A (browser → Mondaily API proxy → STT appliance → LiveKit data
channel)**, staging/canary only, fail-closed and honest under every failure. Implementation to follow
only on explicit approval; production remains off until Tier B.
