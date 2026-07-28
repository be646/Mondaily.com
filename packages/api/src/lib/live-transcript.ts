/**
 * Phase B — honest provenance for a call's transcript. The saved live transcript and the (later) recording
 * transcript must NEVER be silently mixed: this maps the recording lifecycle on a call_sessions row to a
 * single, honest label so the UI can say exactly where a transcript came from. Meeting calls have no
 * session row → "live_only" (the live transcript IS the record).
 */
export type LiveTranscriptProvenance =
  | "live_only"                        // no recording opted-in — the live transcript is the record
  | "recording_pending"                // recording opted-in, its transcript is still processing
  | "recording_available"             // a recording transcript exists (authoritative; live is the backup)
  | "recording_failed_live_fallback"; // recording/transcription failed → the live transcript is the fallback

export interface SessionRecordingState {
  record?: boolean | null;
  recording_status?: string | null;   // null | recording | processing | ready | failed | failed_start
  transcript_status?: string | null;  // null | pending | processing | queued | ready | failed
  memory_node_id?: string | null;
}

/** Pure: derive the honest provenance label from a session's recording/transcription lifecycle. */
export function liveTranscriptProvenance(s: SessionRecordingState | null | undefined): LiveTranscriptProvenance {
  if (!s) return "live_only";
  if (s.transcript_status === "ready" && s.memory_node_id) return "recording_available";
  if (s.recording_status === "failed" || s.recording_status === "failed_start" || s.transcript_status === "failed") {
    return "recording_failed_live_fallback";
  }
  if (s.record && (s.recording_status || s.transcript_status)) return "recording_pending";
  return "live_only";
}
