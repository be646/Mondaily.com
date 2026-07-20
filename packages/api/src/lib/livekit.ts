import { sign, verify } from "hono/jwt";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Sovereign LiveKit + speech-to-text helpers for Meeting Memory.
 *
 * FULL SOVEREIGNTY: LiveKit is self-hosted (open-source), and transcription runs against a
 * self-hosted STT appliance at SOVEREIGN_STT_URL — NEVER a third-party STT SaaS. Everything here
 * is FAIL-CLOSED: if the required env isn't present, the capability reports disabled and no
 * external call is attempted, so the product never fakes a recording or a transcript.
 *
 * Two independent capabilities:
 *   - recording      — LiveKit egress must be configured (server-side storage) AND the operator
 *                       flips LIVEKIT_RECORDING_ENABLED=1. Produces an audio file URL.
 *   - transcription  — SOVEREIGN_STT_URL must point at the self-hosted STT appliance. Turns that
 *                       audio file into a real transcript we can summarize.
 *
 * Recording is always OPT-IN per call/meeting (the initiator asks for it); these helpers only
 * describe capability and perform the mechanics — the consent decision lives at the call sites.
 */

const env = () => ({
  url: process.env.LIVEKIT_URL,
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
});

/** LiveKit calling itself (token minting) — mirrors live-calls.isEnabled(). */
export const liveKitEnabled = (): boolean => {
  const e = env();
  return !!(e.url && e.key && e.secret);
};

/** Recording requires LiveKit + egress storage wired server-side, confirmed by the operator flag. */
export const recordingEnabled = (): boolean => liveKitEnabled() && process.env.LIVEKIT_RECORDING_ENABLED === "1";

/**
 * NON-DESTRUCTIVE readiness self-test: proves the configured LIVEKIT_API_KEY/SECRET can actually sign a
 * join token. It ONLY mints a short-lived (60s) token for a synthetic self-test room and discards it —
 * no network call to LiveKit, no room created, no participant, NO recording/egress. Returns booleans
 * only; never returns the token, key, or secret. Fails closed when LiveKit env is absent.
 */
export async function livekitSelfTest(): Promise<{ ok: boolean; token_minted: boolean; reason?: string }> {
  if (!liveKitEnabled()) return { ok: false, token_minted: false, reason: "livekit_not_configured" };
  try {
    const { key, secret } = env();
    const now = Math.floor(Date.now() / 1000);
    // A minimal join grant to a throwaway room — proves the HS256 secret signs. Never sent anywhere.
    const token = await sign(
      { iss: key, sub: "readiness-selftest", nbf: now, iat: now, exp: now + 60, video: { room: "readiness-selftest", roomJoin: true } },
      secret as string,
      "HS256",
    );
    return { ok: !!token, token_minted: !!token };
  } catch {
    return { ok: false, token_minted: false, reason: "token_sign_failed" };
  }
}

/** Transcription requires the self-hosted STT appliance. */
export const transcriptionEnabled = (): boolean => !!(process.env.SOVEREIGN_STT_URL || "").trim();

/**
 * LIVE captions need a STREAMING or short-CHUNK sovereign STT endpoint — the batch `/transcribe` behind
 * SOVEREIGN_STT_URL is full-file only and can't drive live captions. Until one of these is configured the
 * UI must honestly say live captions are unavailable (Phase 1 = always false; Phase 2 flips it on).
 */
/**
 * GENERIC live-caption capability — true if ANY live-caption STT endpoint is configured (a future
 * streaming endpoint OR the chunk endpoint). Kept for forward-compat / diagnostics. Do NOT use this to
 * gate the Phase 2 chunk proxy: captionChunk() only calls SOVEREIGN_STT_CHUNK_URL, so gating on this
 * would let the UI claim captions while /caption-chunk 503s when only STREAM_URL is set. Use
 * liveCaptionChunksAvailable() / liveCaptionsAllowed() for the chunk path.
 */
export const liveCaptionsAvailable = (): boolean =>
  !!((process.env.SOVEREIGN_STT_STREAM_URL || "").trim() || (process.env.SOVEREIGN_STT_CHUNK_URL || "").trim());

/**
 * CHUNK-SPECIFIC capability — the exact endpoint captionChunk() calls. This is the source of truth for
 * Phase 2 so the availability gate can never drift from what the proxy actually reaches. Stream support
 * is future-only and intentionally does NOT satisfy this.
 */
export const liveCaptionChunksAvailable = (): boolean => !!(process.env.SOVEREIGN_STT_CHUNK_URL || "").trim();

/**
 * Phase 2 canary gate. Live captions are enabled for a workspace only when (a) the CHUNK STT endpoint is
 * configured (`liveCaptionChunksAvailable()` — never the future stream URL) AND (b) either
 * LIVE_CAPTIONS_WORKSPACES is unset (env-gated only — fine in a staging env with no real tenants) OR it
 * lists this workspace id. Keeps captions off for everyone until an operator opts a workspace in.
 * Production has no SOVEREIGN_STT_CHUNK_URL, so this is always false there — UI stays "unavailable".
 */
export const liveCaptionsAllowed = (workspaceId: string | null | undefined): boolean => {
  if (!liveCaptionChunksAvailable()) return false;
  const allow = (process.env.LIVE_CAPTIONS_WORKSPACES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0) return true;
  return !!workspaceId && allow.includes(workspaceId);
};

const sttBase = () => (process.env.SOVEREIGN_STT_URL || "").replace(/\/$/, "");
const chunkBase = () => (process.env.SOVEREIGN_STT_CHUNK_URL || "").replace(/\/$/, "");

/** Max caption chunk the API will forward (~a few seconds of 16k PCM is <100KB; cap generously). */
export const CAPTION_CHUNK_MAX_BYTES = Number(process.env.CAPTION_CHUNK_MAX_BYTES || 2 * 1024 * 1024);

export interface CaptionChunkResult { ok: boolean; status: number; text: string; no_speech: boolean; language: string | null; confidence: number | null }

/**
 * Server-side proxy to the sovereign live-STT appliance (`POST {SOVEREIGN_STT_CHUNK_URL}/caption/chunk`).
 * The bearer SOVEREIGN_STT_KEY is added HERE and NEVER reaches the browser. Returns text only — the audio
 * is forwarded straight through, never stored, never logged; the transcript is returned to the caller and
 * not persisted. Fails closed (ok:false) on missing config, non-2xx, timeout, or network error so the
 * caller publishes NO caption rather than inventing one.
 */
export async function captionChunk(input: {
  audio: ArrayBuffer; format: string; sampleRate: number; session: string; seq: number; language?: string; final?: boolean;
}): Promise<CaptionChunkResult> {
  const base = chunkBase();
  const fail = (status: number): CaptionChunkResult => ({ ok: false, status, text: "", no_speech: false, language: null, confidence: null });
  if (!base) return fail(503);
  const fd = new FormData();
  fd.append("audio", new Blob([input.audio]), "chunk.bin");
  fd.append("format", input.format);
  fd.append("sample_rate", String(input.sampleRate));
  fd.append("session", input.session);
  fd.append("seq", String(input.seq));
  if (input.language) fd.append("language", input.language);
  if (input.final != null) fd.append("final", String(input.final));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${base}/caption/chunk`, {
      method: "POST",
      // Do NOT set Content-Type — fetch sets the multipart boundary. Bearer stays server-side.
      headers: { ...(process.env.SOVEREIGN_STT_KEY ? { Authorization: `Bearer ${process.env.SOVEREIGN_STT_KEY}` } : {}) },
      body: fd,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // TEMP DIAG (no secret values): reveals whether the bearer is present at runtime + appliance status.
      console.error(`[captionChunk][diag] applianceStatus=${res.status} base=${base} keyLen=${(process.env.SOVEREIGN_STT_KEY || "").length} keyChunkUrlLen=${(process.env.SOVEREIGN_STT_CHUNK_URL || "").length}`);
      return fail(res.status);
    }
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: true, status: 200,
      text: typeof j.text === "string" ? j.text : "",
      no_speech: j.no_speech === true,
      language: typeof j.language === "string" ? j.language : null,
      confidence: typeof j.confidence === "number" ? j.confidence : null,
    };
  } catch {
    return fail(504); // abort/network → transient; caller drops the chunk, never fakes text
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic, tenant-namespaced egress output path (so files can never collide across rooms). */
export function egressFilepath(room: string): string {
  const safe = room.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `recordings/${safe}.ogg`;
}

/** Mint a short-lived egress-authorized token (roomRecord grant) — same HS256 scheme as join tokens. */
async function mintEgressToken(): Promise<string> {
  const { key, secret } = env();
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { iss: key, sub: "egress", nbf: now, iat: now, exp: now + 10 * 60, video: { roomRecord: true } },
    secret as string,
    "HS256",
  );
}

/**
 * Start an audio-only room-composite egress for `room`. Returns the egress id (persisted so the
 * webhook can correlate the finished file back to the session), or null if recording is disabled
 * or LiveKit refuses — the caller then leaves recording_status null (honestly "not recorded").
 */
export async function startRoomEgress(room: string): Promise<{ egressId: string } | null> {
  if (!recordingEnabled()) return null;
  const { url } = env();
  try {
    const token = await mintEgressToken();
    const res = await fetch(`${(url as string).replace(/\/$/, "")}/twirp/livekit.Egress/StartRoomCompositeEgress`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ room_name: room, audio_only: true, file_outputs: [{ filepath: egressFilepath(room) }] }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { egress_id?: string; egressId?: string };
    const egressId = body.egress_id || body.egressId;
    return egressId ? { egressId } : null;
  } catch {
    return null;
  }
}

/** Mint a short-lived room-admin token (roomAdmin grant scoped to one room) for RoomService calls. */
async function mintRoomAdminToken(room: string): Promise<string> {
  const { key, secret } = env();
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { iss: key, sub: "admin", nbf: now, iat: now, exp: now + 2 * 60, video: { roomAdmin: true, room } },
    secret as string,
    "HS256",
  );
}

/**
 * End a call for EVERYONE — deletes the LiveKit room, which disconnects all participants. Used by the
 * organizer's "End for everyone" (leaving only disconnects yourself). Best-effort + returns whether it
 * succeeded. Recording egress is stopped separately by the caller before/after.
 */
export async function endRoom(room: string): Promise<boolean> {
  if (!liveKitEnabled() || !room) return false;
  const { url } = env();
  try {
    const token = await mintRoomAdminToken(room);
    const res = await fetch(`${(url as string).replace(/\/$/, "")}/twirp/livekit.RoomService/DeleteRoom`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ room }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Remove ONE participant from a room — LiveKit disconnects them and (since their join token is one-shot
 * and room-scoped) they cannot silently rejoin the same session. Used by the host to eject an external
 * guest. Best-effort; returns whether LiveKit accepted the removal. Uses the same short-lived roomAdmin
 * token as endRoom — the guest NEVER receives roomAdmin.
 */
export async function removeParticipant(room: string, identity: string): Promise<boolean> {
  if (!liveKitEnabled() || !room || !identity) return false;
  const { url } = env();
  try {
    const token = await mintRoomAdminToken(room);
    const res = await fetch(`${(url as string).replace(/\/$/, "")}/twirp/livekit.RoomService/RemoveParticipant`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ room, identity }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stop a running egress (best-effort; called when the call ends). */
export async function stopRoomEgress(egressId: string): Promise<void> {
  if (!recordingEnabled() || !egressId) return;
  const { url } = env();
  try {
    const token = await mintEgressToken();
    await fetch(`${(url as string).replace(/\/$/, "")}/twirp/livekit.Egress/StopEgress`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ egress_id: egressId }),
    });
  } catch {
    /* best-effort */
  }
}

// ── Webhook verification ──────────────────────────────────────────────────────────

export interface EgressWebhook {
  event: string;                 // "egress_started" | "egress_ended" | ...
  egressId: string | null;
  status: string | null;         // EGRESS_COMPLETE / EGRESS_FAILED / ...
  url: string | null;            // final file location, when complete
}

/**
 * Parse a LiveKit egress webhook payload defensively (LiveKit uses snake_case protobuf-JSON and
 * has shifted field names across versions, so accept both `file`/`fileResults` and
 * `location`/`filename`). Only egress events are relevant here.
 */
export function parseEgressWebhook(raw: unknown): EgressWebhook | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, any>;
  const event = String(b.event ?? "");
  if (!event.startsWith("egress")) return null;
  const info = b.egressInfo ?? b.egress_info ?? {};
  const file = info.file ?? (Array.isArray(info.fileResults) ? info.fileResults[0] : undefined) ?? (Array.isArray(info.file_results) ? info.file_results[0] : undefined) ?? {};
  return {
    event,
    egressId: info.egressId ?? info.egress_id ?? b.egressId ?? b.egress_id ?? null,
    status: info.status ?? null,
    url: file.location ?? file.filename ?? file.downloadUrl ?? file.download_url ?? null,
  };
}

/**
 * Verify a LiveKit webhook. LiveKit signs the raw body with an Authorization header carrying a JWT
 * whose `sha256` claim is the base64 SHA-256 of the body. We verify the JWT signature with our API
 * secret AND that the hash matches (timing-safe) — so a valid-but-replayed body for a different
 * payload is rejected. Returns false (not throws) on any problem, so the route can 401 cleanly.
 */
export async function verifyLiveKitWebhook(rawBody: string, authHeader: string | undefined): Promise<boolean> {
  const { secret } = env();
  if (!secret || !authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  try {
    const claims = (await verify(token, secret, "HS256")) as { sha256?: string };
    if (!claims?.sha256) return false;
    const expected = createHash("sha256").update(rawBody).digest("base64");
    const a = Buffer.from(claims.sha256);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── Speech-to-text (self-hosted appliance) ──────────────────────────────────────────

export interface TranscriptLine { speaker: string; text: string; start_time?: number }

/**
 * Normalize an STT appliance response into our transcript line shape. Accepts either a
 * diarized `segments`/`transcript` array or a single `text` blob — whatever the appliance emits.
 * Pure + defensive so it's fully unit-testable without the network.
 */
export function mapSttResponse(payload: unknown): TranscriptLine[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, any>;
  const segs = Array.isArray(p.segments) ? p.segments : Array.isArray(p.transcript) ? p.transcript : null;
  if (segs) {
    return segs
      .map((s: any) => ({
        speaker: String(s?.speaker ?? s?.speaker_label ?? "Speaker"),
        text: String(s?.text ?? s?.content ?? "").trim(),
        start_time: typeof s?.start === "number" ? s.start : typeof s?.start_time === "number" ? s.start_time : undefined,
      }))
      .filter((l: TranscriptLine) => l.text.length > 0);
  }
  const text = typeof p.text === "string" ? p.text.trim() : "";
  return text ? [{ speaker: "Transcript", text }] : [];
}

/**
 * Send an audio file URL to the sovereign STT appliance and return diarized transcript lines.
 * Returns null on any failure (disabled, network, non-2xx) so the caller marks the transcript
 * failed rather than inventing one.
 */
export async function transcribeAudio(audioUrl: string): Promise<TranscriptLine[] | null> {
  if (!transcriptionEnabled() || !audioUrl) return null;
  try {
    const res = await fetch(`${sttBase()}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SOVEREIGN_STT_KEY ? { Authorization: `Bearer ${process.env.SOVEREIGN_STT_KEY}` } : {}),
      },
      body: JSON.stringify({ audio_url: audioUrl, diarize: true }),
    });
    if (!res.ok) return null;
    return mapSttResponse(await res.json().catch(() => ({})));
  } catch {
    return null;
  }
}
