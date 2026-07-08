import { inngest } from "../lib/inngest";
import { ingestRecording } from "./meeting-memory";

/**
 * Inngest worker for Meeting Memory. The LiveKit egress webhook emits `meeting/recording.ready`
 * once an audio file exists; transcription + summarization can outlast a webhook's budget, so it
 * runs here with Inngest's retries. Idempotent (the pipeline no-ops if already ingested), so a
 * retry after a partial failure is safe.
 */
export const meetingRecordingWorker = inngest.createFunction(
  { id: "meeting-recording-ingest", name: "Meeting Memory ingest", concurrency: { limit: 4 } },
  { event: "meeting/recording.ready" },
  async ({ event }) => {
    const sessionId = (event.data as { sessionId?: string })?.sessionId;
    if (!sessionId) return { ok: false, reason: "no_session_id" };
    return ingestRecording(sessionId);
  },
);
