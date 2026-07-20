# Live Transcript + Multilingual Translation + Saved Transcript — Spec (audit-only)

> **Design/roadmap doc. No code yet.** Extends Live Captions (Phase 1/2, shipped) toward: a readable
> live transcript timeline, per-participant live translation, and a transcript saved to the session so
> Meeting Memory has one even if recording-transcription fails. Sovereign-only, fail-closed, no fake text.
> Companion to [`LIVE_CAPTIONS_STT_CONTRACT.md`](./LIVE_CAPTIONS_STT_CONTRACT.md) and
> [`PHASE2_SCOPE.md`](./PHASE2_SCOPE.md).

---

## Current state (audited)

- **Captions transport** — `packages/shared/src/captions.ts`: `CaptionPacket { t, id, participantId,
  name, text, final, ts }`, broadcast over the LiveKit **data channel**, **ephemeral** (never stored),
  self-captioning (each speaker publishes their own). No `language` field yet.
- **Caption proxy** — member `POST /api/v1/live-calls/caption-chunk` + guest
  `POST /api/v1/public/calls/caption-chunk` already **return `{ text, no_speech, language, confidence }`**
  (the appliance detects language). So a **detected source language already flows to the client** — it's
  just not put on the packet or shown.
- **Capture hook** — `apps/app/src/routes/dashboard/use-caption-capture.ts`: local-mic → PCM 16k →
  proxy → on non-empty text the caller publishes a `CaptionPacket`. Panel keeps the last ~60 lines
  (ephemeral, dedup by id). No persistence, no timeline, no translation.
- **Meeting Memory** — `packages/api/src/jobs/meeting-memory.ts`: post-call **batch** STT
  (`SOVEREIGN_STT_URL`, `small`) → `TranscriptLine[] {speaker,text,start_time}` stored on the call node;
  AI overview + outcomes via `aiGateway`. `call_sessions` has `transcript_status`
  (null/processing/ready/failed), `memory_node_id`, `language`. **Fail-closed**: STT off/failing →
  `transcript_status:"failed"`, no invented transcript.
- **AI gateway** — `packages/api/src/lib/ai-gateway.ts`: `aiGateway()` (plain text gen, sovereign
  Cerebras), metered, fail-closed on missing env. This is the **private translation path** — no
  third-party needed.
- **Guest flow** — guest captions on `/public/calls/*` only, token + consent + canary gated; guest
  LiveKit token grants `canPublishData` so guests already send/receive data-channel packets.

## Gaps (what's missing for the ask)

1. **No readable transcript timeline** — captions are a transient rolling panel, not an accumulating,
   timestamped, speaker-grouped log.
2. **`CaptionPacket` carries no `lang`** — detected language is returned by the proxy but dropped.
3. **No translation path** — nothing translates a caption to a viewer's preferred language.
4. **No per-participant language preference** — no selector, no persistence of choice.
5. **No saved live transcript** — captions are deliberately ephemeral; nothing persists them, so if
   recording-transcription fails there is **no** transcript for Meeting Memory.
6. **Meeting Memory has no merge/provenance model** — it assumes one batch transcript; no notion of a
   "live" transcript vs a later "recording" transcript, or merging them.
7. **No honest UI states** for translated / original-available / saved / recording-pending-or-failed.

## Safest architecture

**Principle:** the broadcast packet stays the **original text only** (one sovereign broadcast, room-scoped);
**translation is a per-viewer concern** resolved through a cached, sovereign server endpoint. Persistence
of the transcript is **publisher-side, consent-gated**, one row per final line.

1. **Transcript timeline (client):** each client accumulates **final** `CaptionPacket`s into an ordered
   list keyed by `id` (speaker, ts, original text, detected `lang`). Every participant already receives
   all finals over the data channel, so each renders the **same** timeline locally. Interim/partial lines
   are shown transiently but only **finals** enter the timeline.
2. **Detected language:** add `lang?: string` to `CaptionPacket` (from the proxy's `language`). Publisher
   sets it; parser accepts+validates it; viewers show a language chip + decide whether translation is
   needed (`viewerTarget !== lang`).
3. **Live translation (per viewer, sovereign, cached):** when a viewer's chosen language ≠ a line's
   detected `lang`, the viewer calls a **translate endpoint** → `aiGateway` translates → returns text.
   - **Cache** by `hash(text + target)` (in-memory LRU per warm API instance; translations are ephemeral)
     so N viewers of the same line cause ≤1 model call.
   - **Only finals** are translated (never churny partials).
   - **Progressive render:** show the **original instantly**, swap in the translation when it returns; if
     the model is unavailable → keep original + an honest "translation unavailable" chip (**never fake**).
   - "Auto" target = show original (+ optional translate-to-workspace-default); explicit target
     (English/Polish/Arabic/…) = translate when source differs.
4. **Saved transcript (publisher-side, consent-gated):** on each **final** line, the speaker's client
   also POSTs it to a persistence endpoint that appends **one row per line** (avoids append races),
   workspace-scoped, idempotent by `(session, seq)`. This builds a real transcript **independent of
   recording**.
5. **Meeting Memory merge (honest provenance):** on call end, if the recording transcript is
   absent/`failed`, Meeting Memory composes from the **saved live transcript** (marked
   `source:"live"`). If a recording transcript later succeeds, it **enriches/replaces** with
   `source:"recording"` (higher quality), keeping the live one as honest fallback; never silently mixes
   without provenance.

## Data model needed

Prefer the existing **schema-free `nodes`** pattern (no migration), matching Meeting Memory / waiting-room.

- **`CaptionPacket`** (shared): add `lang?: string` (detected source language; validated, clamped).
- **Live transcript line** — `nodes` rows, `object_type = "call_transcript_line"`,
  `data = { session_id, seq, participant_id, speaker, text, lang, ts, source:"live" }`, workspace-scoped.
  One row per final line; idempotent on `(session_id, seq)`. (Alternative: a `live_transcript jsonb`
  column on `call_sessions` — cleaner reads but needs a migration and atomic-append handling. Rows are
  the no-migration, race-free choice.)
- **`call_sessions`** (existing): reuse `transcript_status` + add semantics — a new value
  `live_saved` (or a `live_transcript_status`) so state is honest: `live_saved` → `processing`
  (recording) → `ready`/`failed`. No new table required if we track status via existing columns + a
  small additive column later.
- **Translation cache:** in-memory only (ephemeral). If we later persist translated transcripts,
  `nodes` `object_type = "transcript_translation"` `data={line_id, target, text}`.
- **Per-participant language preference:** client-side `localStorage` (`mondaily_caption_lang`), plus the
  chosen target sent as a query param on translate calls. No server storage needed.

## API changes needed

1. **Extend caption response usage** — no API change (proxy already returns `language`); the client just
   puts it on the packet.
2. **Translate endpoint (sovereign, cached, fail-closed):**
   - member `POST /api/v1/calls/caption-translate?target=<lang>&source=<lang?>` body = text →
     `{ translated }` or `{ translated:null, error }`. Uses `aiGateway` (system: "translate only, output
     only the translation, no commentary; if you cannot, return the original"). Rate-limited, metered,
     canary-gated (same `liveCaptionsAllowed(ws)`).
   - guest `POST /api/v1/public/calls/caption-translate` — token (X-Guest-Token) + consent + canary,
     public-only, same shape.
3. **Transcript-line persistence (consent-gated):**
   - member `POST /api/v1/calls/:sessionId/transcript-line` body = `{ seq, text, lang, ts }` → appends a
     `call_transcript_line` node (workspace-scoped, idempotent, rate-limited). Server derives speaker
     from the authed member.
   - guest `POST /api/v1/public/calls/transcript-line` — token + consent; speaker = guest display name.
   - GET (member) `/api/v1/calls/:sessionId/transcript` → ordered saved lines (for the timeline
     recovery + Meeting Memory).
4. **Meeting Memory** (`jobs/meeting-memory.ts`): if no recording transcript, read saved live lines →
   compose summary from them (`source:"live"`); on later recording success, merge with provenance and
   re-summarize honestly. Keep the "no invented transcript" guarantee.
5. **Readiness:** surface `live_translation_available` (= AI gateway configured) and
   `live_transcript_save_available` (= config + consent) so the UI gates honestly.

## UI changes needed

- **Caption language selector** in the CC panel (English / Polish / Arabic / Auto …), persisted in
  `localStorage`; applies to the viewer only. Guests get the same selector.
- **Transcript timeline** (new tab/section in the call): scrollable, speaker + timestamp + original +
  translated (when enabled) + a detected-language chip; "show original / translated" toggle.
- **Honest state chips:** `Live transcript` · `Translated` / `Original available` · `Saved ✓` ·
  `Recording transcript: pending / failed / merged`. Translation-unavailable → original + "translation
  unavailable" (no fake). No-speech → no line.
- **Progressive translation:** original first, translation swaps in; small "translating…" affordance,
  never a blank or a guessed line.
- **Consent notice** expanded: captions + (if enabled) **saved transcript** — "your speech is
  transcribed and saved to this meeting's memory; translations run on Mondaily's sovereign AI." Host +
  guest identical.

## Sovereignty / security risks

- **Translation must be sovereign** — `aiGateway` (Cerebras) only; **no Google/DeepL/browser
  translation** unless explicitly approved. No Web Speech API (already enforced by guards; extend guards
  to the translate path).
- **New persistence** — saved transcript is a new data flow; **consent-gated**, workspace-scoped, guest
  lines attributed to the chosen display name only (no extra PII). Needs a **retention/lifecycle** policy
  (transcripts can accumulate) — Meeting Memory already persists transcripts, so precedent + same policy.
- **Cost/metering** — translation is per-line per-target; **cache + finals-only + rate-limit** to avoid
  runaway AI spend; metered through the gateway like other AI.
- **Guest endpoints** — token + consent + canary + rate-limited, public-only (never authed APIs), same
  hardening as `caption-chunk`.
- **No key/appliance/gateway leak to frontend** — translate + persist go through the API; guard tests
  extend the "no secrets in `apps/app`" scan.
- **Honesty invariants** — no fake transcript, no invented speaker text, no translation when the model is
  unavailable (show original), no silent merge without provenance.

## Rollout phases

- **Phase A — Live readable transcript timeline (ephemeral, no translation, no save).** Add `lang` to
  `CaptionPacket`+parser; client accumulates finals into a timeline (speaker/ts/lang chip); keep the
  rolling caption panel. Frontend-only + one shared-type field. Lowest risk, lays the data shape.
- **Phase B — Saved live transcript + Meeting Memory fallback.** Persist finals (consent-gated) as
  `call_transcript_line` nodes; Meeting Memory uses them when recording transcript is absent/failed;
  honest `Saved ✓` + `source:"live"`. Backend + MM.
- **Phase C — Live per-participant translation.** Language selector + sovereign `caption-translate`
  (member+guest) + cache + progressive render + honest "unavailable"; guests included.
- **Phase D — Merge/enrich + translated transcript.** On later recording success, merge with provenance;
  optional on-demand translation of the saved transcript for post-call reading.

## Exact first implementation phase (Phase A)

Ship **the live readable transcript timeline only** — ephemeral, no translation, no persistence:

1. `packages/shared/src/captions.ts`: add optional `lang?: string` to `CaptionPacket`; `parseCaptionPacket`
   accepts + validates + clamps it (unknown/absent → omitted). Update Phase-1/2 tests.
2. `use-caption-capture.ts` `onCaption`: include `lang` from the proxy response on the published packet.
3. `call-room.tsx` + `guest-call.tsx`: build an ordered **transcript timeline** from **final** packets
   (speaker, `ts`→clock time, original text, `lang` chip) and render it (a "Transcript" view in the
   captions panel); keep the existing rolling captions. Honest empty state ("Transcript will build as
   people speak"). No persistence, no translation, no network beyond the existing caption path.
4. Guards/tests: `lang` parsed/dropped-if-invalid; timeline only from finals; still no Web Speech / no
   third-party / no secrets in frontend / no persistence added.
5. Verify: app+API typecheck, app build, API tests, sovereignty audit, public e2e — then commit.

This is additive, sovereign, fully honest, and unblocks B/C/D without touching persistence, the AI
gateway, or the appliance.
