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

/** Transcription requires the self-hosted STT appliance. */
export const transcriptionEnabled = (): boolean => !!(process.env.SOVEREIGN_STT_URL || "").trim();

const sttBase = () => (process.env.SOVEREIGN_STT_URL || "").replace(/\/$/, "");

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
