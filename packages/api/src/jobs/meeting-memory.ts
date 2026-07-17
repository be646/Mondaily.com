import { supabase } from "@mondaily/db/client";
import { aiGateway, aiGatewayToolUse } from "../lib/ai-gateway";
import { transcribeAudio, transcriptionEnabled, type TranscriptLine } from "../lib/livekit";
import { startJob, completeJob, failJob, step, type AgentStep } from "../lib/agent-logger";
import { createNotification } from "../lib/notify";
import { maybeAutoApprove } from "../lib/autonomy";

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

interface MeetingIntel { overview: string; key_topics: string[]; action_items: { text: string; owner?: string }[]; decisions: string[]; next_steps: string[] }

/**
 * The AI MEETING AGENT: from the real transcript, extract a factual overview PLUS structured outcomes
 * (key topics, action items with owners when stated, decisions made, next steps). Grounded strictly in
 * the transcript — empty arrays are correct when nothing was said. Fail-soft to an empty result.
 */
async function extractMeetingIntel(ws: string, userId: string, lines: TranscriptLine[]): Promise<MeetingIntel> {
  const empty: MeetingIntel = { overview: "", key_topics: [], action_items: [], decisions: [], next_steps: [] };
  const transcript = lines.map((l) => `${l.speaker}: ${l.text}`).join("\n").slice(0, 24_000);
  try {
    const r = await aiGatewayToolUse({
      system: "You are a meeting analyst. From the call transcript, produce a tight factual overview and structured outcomes. Use ONLY what the transcript actually states — never infer, never invent an owner or an item that wasn't discussed. Empty arrays are correct when nothing was said. Action items are concrete tasks someone agreed to do; owner is a name ONLY if the transcript names who owns it.",
      prompt: `Transcript:\n${transcript}`,
      toolName: "record_meeting",
      toolDescription: "Record the meeting's overview and structured outcomes.",
      toolSchema: {
        type: "object",
        properties: {
          overview: { type: "string" },
          key_topics: { type: "array", items: { type: "string" } },
          action_items: { type: "array", items: { type: "object", properties: { text: { type: "string" }, owner: { type: "string" } }, required: ["text"] } },
          decisions: { type: "array", items: { type: "string" } },
          next_steps: { type: "array", items: { type: "string" } },
        },
        required: ["overview"],
      },
      maxTokens: 900, workspaceId: ws, userId, feature: "meeting_memory_intel", taskClass: "meeting",
    });
    const o = (r ?? {}) as Record<string, unknown>;
    const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
    const items = Array.isArray(o.action_items) ? (o.action_items as Record<string, unknown>[]) : [];
    return {
      overview: String(o.overview ?? "").trim(),
      key_topics: strs(o.key_topics).slice(0, 8),
      action_items: items.map((a) => ({ text: String(a.text ?? "").trim(), owner: a.owner ? String(a.owner).trim() : undefined })).filter((a) => a.text).slice(0, 10),
      decisions: strs(o.decisions).slice(0, 8),
      next_steps: strs(o.next_steps).slice(0, 8),
    };
  } catch {
    return empty;
  }
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
      // Never expose the raw storage/egress location to the client — playback (upload OR native)
      // always goes through the short-lived signed-URL endpoint. The server keeps the real location
      // on the session (recording_url) for STT only.
      has_recording: true,
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

    // 4. MEETING AGENT — extract overview + structured outcomes (best-effort; a missing/exhausted
    //    gateway must not lose the transcript). Falls back to the plain text summary if extraction fails.
    let intel = await extractMeetingIntel(ws, session.initiator_id, lines);
    if (!intel.overview) {
      try { intel = { ...intel, overview: await summarizeTranscript(ws, session.initiator_id, lines) }; } catch { /* keep empty */ }
    }
    const summary = intel.overview;
    await supabase.from("nodes").update({
      ai_summary: summary || null,
      data: {
        ...baseData, status: "processed",
        overview: summary || undefined,
        key_topics: intel.key_topics,
        action_items: intel.action_items.map((a) => (a.owner ? `${a.text} — ${a.owner}` : a.text)),
        next_steps: intel.next_steps,
        decisions: intel.decisions,
      },
    }).eq("id", nodeId).eq("workspace_id", ws);
    steps.push(summary
      ? step("Meeting analyzed", { detail: `Overview + ${intel.action_items.length} action item(s), ${intel.decisions.length} decision(s) extracted.` })
      : step("Summary pending", { status: "warn", detail: "AI gateway unavailable — transcript saved, analysis can be generated later." }));

    // 4b. AUTO-DRAFT follow-ups — each action item becomes a Decision Queue proposal (agents prepare,
    //     you approve). Deduped against this call's already-drafted items so re-runs don't pile up.
    let drafted = 0;
    if (intel.action_items.length) {
      const { data: already } = await supabase.from("decision_queue")
        .select("recommended_action").eq("workspace_id", ws).eq("source_id", nodeId).eq("source_type", "meeting_action");
      const seen = new Set((already ?? []).map((d) => String(d.recommended_action).toLowerCase()));
      for (const a of intel.action_items) {
        const action = a.owner ? `${a.text} (owner: ${a.owner})` : a.text;
        if (seen.has(action.toLowerCase())) continue;
        const { data: dq } = await supabase.from("decision_queue").insert({
          workspace_id: ws, source_type: "meeting_action", source_id: nodeId, agent_name: "meeting",
          title: `Follow-up from your call: ${a.text.slice(0, 80)}`,
          summary: `Action item captured from your ${session.kind} call with ${other}.${a.owner ? ` Owner: ${a.owner}.` : ""}`,
          recommended_action: action, risk_level: "low",
          evidence: [{ type: "meeting", title: other, node_id: nodeId, match_reason: "Action item from the call transcript" }],
        }).select("*").single().then((x) => x, () => ({ data: null }));
        if (dq) { await maybeAutoApprove(ws, dq); drafted++; }
      }
      if (drafted) steps.push(step(`Drafted ${drafted} follow-up${drafted === 1 ? "" : "s"}`, { detail: "Action items queued in Decisions for your approval." }));
    }

    // 5. Notify both participants their meeting memory is ready.
    for (const uid of new Set([session.initiator_id, session.invitee_id])) {
      await createNotification({
        workspace_id: ws, user_id: uid, type: "call",
        title: "Meeting recording ready",
        body: `Your ${session.kind} call with ${other} has been transcribed${summary ? ", summarized" : ""}${drafted ? ` and ${drafted} follow-up${drafted === 1 ? "" : "s"} were drafted` : ""}.`,
        metadata: { call_node_id: nodeId, session_id: session.id },
      }).catch(() => false);
    }

    await completeJob(jobId, { ok: true, node_id: nodeId, segments: lines.length, summarized: !!summary, action_items: intel.action_items.length, drafted }, steps);
    return { ok: true, node_id: nodeId };
  } catch (e) {
    await supabase.from("call_sessions").update({ transcript_status: "failed" }).eq("id", session.id);
    await failJob(jobId, e instanceof Error ? e.message : "ingestion failed");
    return { ok: false, reason: "error" };
  }
}
