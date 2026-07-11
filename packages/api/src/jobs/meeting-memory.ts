import { supabase } from "@mondaily/db/client";
import { aiGateway } from "../lib/ai-gateway";
import { transcribeAudio, transcriptionEnabled, type TranscriptLine } from "../lib/livekit";
import { startJob, completeJob, failJob, step, type AgentStep } from "../lib/agent-logger";
import { createNotification } from "../lib/notify";

/**
 * Meeting Memory ingestion — the pipeline that turns a finished LiveKit recording into a real,
 * searchable, summarized call_record node. Triggered by the LiveKit egress webhook once the audio
 * file exists.
 *
 * HONEST BY CONSTRUCTION:
 *  - No audio file → nothing happens (we never fabricate a recording).
 *  - STT appliance off or failing → transcript_status "failed", NO invented transcript.
 *  - AI gateway off or failing → transcript is still stored, summary stays empty ("pending"),
 *    never a placeholder summary.
 * Every stage is logged as canonical proof-of-work on agent_jobs so the Control Room shows exactly
 * what happened, when, and against which real audio file.
 */

interface SessionRow {
  id: string; workspace_id: string; room: string; initiator_id: string; invitee_id: string;
  kind: string; started_at: string | null; ended_at: string | null; created_at: string;
  record: boolean; recording_url: string | null; recording_status: string | null;
  transcript_status: string | null; memory_node_id: string | null;
  source?: string | null; origin_filename?: string | null; language?: string | null; duration_sec?: number | null;
}

// Private bucket for uploaded meeting audio. Recordings are NEVER public — the STT appliance and the
// player both fetch through short-lived signed URLs minted from the stored path.
export const RECORDINGS_BUCKET = "meeting-recordings";

/** Mint a short-lived signed URL for an uploaded recording's storage PATH (never returns the path). */
async function signedRecordingUrl(path: string, ttlSec = 300): Promise<string | null> {
  const { data } = await supabase.storage.from(RECORDINGS_BUCKET).createSignedUrl(path, ttlSec);
  return data?.signedUrl ?? null;
}

async function memberNames(ws: string): Promise<Map<string, string>> {
  const { data } = await supabase.from("workspace_members").select("user_id, name, email").eq("workspace_id", ws);
  return new Map((data ?? []).map((m) => [String(m.user_id), String(m.name || m.email || "Member")]));
}

/** Compose a one-paragraph overview from the real transcript via the sovereign AI gateway. */
async function summarizeTranscript(ws: string, userId: string, lines: TranscriptLine[]): Promise<string> {
  const transcript = lines.map((l) => `${l.speaker}: ${l.text}`).join("\n").slice(0, 24_000);
  const res = await aiGateway({
    system: "You summarize a call transcript for a busy operator. Write a tight, factual 3-5 sentence overview: who spoke, what was decided, and any clear next step. Use ONLY what the transcript states — never infer or embellish. If the transcript is too thin to summarize, say so plainly.",
    prompt: `Transcript:\n${transcript}`,
    maxTokens: 400,
    workspaceId: ws,
    userId,
    feature: "meeting_memory_summary", taskClass: "meeting",
  });
  return (res.text || "").trim();
}

/**
 * Ingest one recorded session into Meeting Memory. Idempotent: if a memory node already exists for
 * the session it is reused (re-runs from webhook retries won't create duplicates).
 */
export async function ingestRecording(sessionId: string): Promise<{ ok: boolean; node_id?: string; reason?: string }> {
  const { data: s } = await supabase
    .from("call_sessions")
    .select("id, workspace_id, room, initiator_id, invitee_id, kind, started_at, ended_at, created_at, record, recording_url, recording_status, transcript_status, memory_node_id, source, origin_filename, language, duration_sec")
    .eq("id", sessionId)
    .maybeSingle();
  const session = s as SessionRow | null;
  if (!session) return { ok: false, reason: "session_not_found" };
  if (!session.record) return { ok: false, reason: "not_opted_in" };
  if (!session.recording_url) return { ok: false, reason: "no_recording" };
  // Already fully ingested — no-op (webhook redelivery safety).
  if (session.transcript_status === "ready" && session.memory_node_id) return { ok: true, node_id: session.memory_node_id };

  const ws = session.workspace_id;

  // ATOMIC CLAIM — LiveKit redelivers egress_ended, so two ingests can run concurrently (Inngest
  // concurrency > 1). This conditional update is a compare-and-set: only ONE runner flips
  // transcript_status to "processing" (the guard `.neq("processing")` stops the loser), and only
  // while nothing has been ingested yet (`memory_node_id IS NULL`). A failed prior run left "failed",
  // so a retry still claims. Without this, both runners read node_id=null and insert duplicate nodes.
  const { data: claimed } = await supabase.from("call_sessions")
    .update({ transcript_status: "processing" })
    .eq("id", session.id).is("memory_node_id", null).neq("transcript_status", "processing")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, reason: "already_processing" };

  const jobId = await startJob({
    workspace_id: ws, agent_name: "Meeting Memory", trigger_type: "webhook",
    input: { session_id: session.id, room: session.room },
  });
  const steps: AgentStep[] = [];

  try {

    // 1. Transcribe against the sovereign STT appliance.
    if (!transcriptionEnabled()) {
      await supabase.from("call_sessions").update({ transcript_status: "failed" }).eq("id", session.id);
      steps.push(step("Transcription unavailable", { status: "warn", detail: "SOVEREIGN_STT_URL is not configured — recording stored, no transcript produced." }));
      await completeJob(jobId, { ok: false, reason: "stt_disabled" }, steps);
      return { ok: false, reason: "stt_disabled" };
    }
    // Uploaded recordings store a private-bucket PATH; mint a short-lived signed URL the STT
    // appliance can fetch. Native egress recordings already carry a fetchable URL.
    const isUpload = session.source === "upload";
    const audioUrl = isUpload ? await signedRecordingUrl(session.recording_url) : session.recording_url;
    if (isUpload && !audioUrl) {
      await supabase.from("call_sessions").update({ transcript_status: "failed" }).eq("id", session.id);
      steps.push(step("Transcription failed", { status: "error", detail: "Could not read the uploaded recording from storage." }));
      await failJob(jobId, "signed URL mint failed");
      return { ok: false, reason: "recording_unreadable" };
    }
    const lines = await transcribeAudio(audioUrl!);
    if (!lines || lines.length === 0) {
      await supabase.from("call_sessions").update({ transcript_status: "failed" }).eq("id", session.id);
      steps.push(step("Transcription failed", { status: "error", detail: "The STT appliance returned no usable transcript.", sources: [{ title: "Recording", url: session.recording_url }] }));
      await failJob(jobId, "STT produced no transcript");
      return { ok: false, reason: "stt_empty" };
    }
    steps.push(step(`Transcribed ${lines.length} segment${lines.length === 1 ? "" : "s"}`, { detail: `From the recording of room ${session.room}.`, sources: [{ title: "Recording", url: session.recording_url }] }));

    // 2. Participants + framing (real member names only).
    const dir = await memberNames(ws);
    const participants = [session.initiator_id, session.invitee_id].map((id) => ({ name: dir.get(id) || "Member" }));
    const other = dir.get(session.invitee_id) || dir.get(session.initiator_id) || "Team call";
    const startedAt = session.started_at || session.created_at;
    const durationSeconds = session.started_at && session.ended_at
      ? Math.max(0, Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000))
      : 0;

    // 3. Materialize (or reuse) the call_record node with the real transcript.
    let nodeId = session.memory_node_id;
    // Uploaded recordings: name the record after the file (never the raw path), and NEVER put the
    // storage path in client-visible `audio_url` — playback goes through the signed-URL endpoint.
    const uploadName = (session.origin_filename ?? "").replace(/\.[^.]+$/, "").trim();
    const baseData = {
      contact_name: isUpload ? (uploadName || "Uploaded recording") : other,
      occurred_at: startedAt, duration_seconds: session.duration_sec ?? durationSeconds,
      direction: "outbound", status: "processing",
      ...(isUpload ? { has_recording: true } : { audio_url: session.recording_url }),
      participants, transcript: lines,
      source: isUpload ? "upload_recording" : "meeting_recording",
      call_session_id: session.id,
      ...(isUpload ? { origin_filename: session.origin_filename ?? undefined } : {}),
    };
    if (nodeId) {
      await supabase.from("nodes").update({ data: baseData }).eq("id", nodeId).eq("workspace_id", ws);
    } else {
      const { data: created } = await supabase.from("nodes").insert({
        workspace_id: ws, vertical: "sales", object_type: "call",
        created_by: session.initiator_id, data: baseData,
      }).select("id").single();
      nodeId = created?.id ?? null;
    }
    if (!nodeId) throw new Error("could not persist memory node");
    await supabase.from("call_sessions").update({ transcript_status: "ready", memory_node_id: nodeId }).eq("id", session.id);
    steps.push(step("Saved to Meeting Memory", { detail: "Transcript stored on a searchable call record.", sources: [{ title: other, node_id: nodeId }] }));

    // 4. Summarize (best-effort — a missing/exhausted gateway must not lose the transcript).
    let summary = "";
    try {
      summary = await summarizeTranscript(ws, session.initiator_id, lines);
    } catch {
      summary = "";
    }
    await supabase.from("nodes").update({
      ai_summary: summary || null,
      data: { ...baseData, status: "processed", overview: summary || undefined },
    }).eq("id", nodeId).eq("workspace_id", ws);
    steps.push(summary
      ? step("Generated summary", { detail: "AI overview written from the transcript." })
      : step("Summary pending", { status: "warn", detail: "AI gateway unavailable — transcript saved, summary can be generated later." }));

    // 5. Notify both participants their meeting memory is ready.
    for (const uid of new Set([session.initiator_id, session.invitee_id])) {
      await createNotification({
        workspace_id: ws, user_id: uid, type: "call",
        title: "Meeting recording ready",
        body: `Your ${session.kind} call with ${other} has been transcribed${summary ? " and summarized" : ""}.`,
        metadata: { call_node_id: nodeId, session_id: session.id },
      }).catch(() => false);
    }

    await completeJob(jobId, { ok: true, node_id: nodeId, segments: lines.length, summarized: !!summary }, steps);
    return { ok: true, node_id: nodeId };
  } catch (e) {
    await supabase.from("call_sessions").update({ transcript_status: "failed" }).eq("id", session.id);
    await failJob(jobId, e instanceof Error ? e.message : "ingestion failed");
    return { ok: false, reason: "error" };
  }
}
