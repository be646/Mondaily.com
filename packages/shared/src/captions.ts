/**
 * Live Captions transport contract (Phase 1) — captions ride the LiveKit room DATA CHANNEL as small
 * JSON packets. They are EPHEMERAL: never stored, never a transcript source (the post-call STT stays the
 * single source of truth). No STT runs yet — this only defines + safely parses the packet shape so the
 * room can render captions honestly once a sovereign chunk/stream STT endpoint exists (Phase 2).
 *
 * Sovereign + room-scoped: packets only travel inside the LiveKit room the participant already joined,
 * so a guest can read captions for THEIR meeting only, and never any workspace data.
 */
export const CAPTION_PACKET_TYPE = "caption" as const;

export interface CaptionPacket {
  t: typeof CAPTION_PACKET_TYPE;
  id: string;             // stable id for this caption line (so a partial can be replaced by its final)
  participantId: string;  // the speaking participant's LiveKit identity (the publisher of their own audio)
  name: string;           // display name of the speaker
  text: string;           // the caption text
  final: boolean;         // false = interim/partial (may be revised), true = finalized line
  ts: number;             // epoch ms, for ordering
}

/**
 * Parse a data-channel payload into a CaptionPacket, or null if it isn't a well-formed caption. Accepts a
 * decoded string, an already-parsed object, or raw bytes (Uint8Array). NEVER throws — malformed packets
 * are dropped, so a hostile or buggy sender can't crash the room.
 */
export function parseCaptionPacket(raw: unknown): CaptionPacket | null {
  let obj: unknown = raw;
  try {
    if (raw instanceof Uint8Array) obj = JSON.parse(new TextDecoder().decode(raw));
    else if (typeof raw === "string") obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.t !== CAPTION_PACKET_TYPE) return null;
  if (typeof o.id !== "string" || !o.id) return null;
  if (typeof o.participantId !== "string" || !o.participantId) return null;
  if (typeof o.text !== "string") return null;
  const text = o.text.trim().slice(0, 2000);
  if (!text) return null;
  const name = (typeof o.name === "string" ? o.name : "").trim().slice(0, 80) || "Speaker";
  const ts = typeof o.ts === "number" && Number.isFinite(o.ts) ? o.ts : 0;
  return {
    t: CAPTION_PACKET_TYPE,
    id: o.id.slice(0, 80),
    participantId: o.participantId.slice(0, 80),
    name,
    text,
    final: o.final === true,
    ts,
  };
}
