import { supabase } from "@mondaily/db/client";
import { startJob, completeJob, failJob, step, type AgentStep } from "../lib/agent-logger";

/**
 * MEETING AGENT — a real, on-demand agent that inspects the workspace's own calendar_event nodes and
 * reports genuine attention items: time conflicts, meetings missing an agenda, and meetings missing a
 * call link. It logs structured proof-of-work to agent_jobs and (only for real conflicts) queues
 * Decision Queue items. Nothing is fabricated — every finding is derived from real event fields, and
 * there is no fake "running" state (the job row is only "running" while this function executes).
 */
export interface MeetingLite {
  id: string; title?: string; start_at: string; end_at?: string;
  description?: string; call_url?: string | null; status?: string;
}
export interface MeetingAnalysis {
  active: MeetingLite[];
  conflicts: [MeetingLite, MeetingLite][];
  missingAgenda: MeetingLite[];
  missingCall: MeetingLite[];
}

export interface TaskLite { id: string; title: string }

const startMs = (m: MeetingLite) => new Date(m.start_at).getTime();
const endMs = (m: MeetingLite) => new Date(m.end_at || m.start_at).getTime();

/** Keyword tokens from a title (len ≥ 4, common meeting words dropped) — used to relate tasks to meetings. */
function titleTokens(text: string): Set<string> {
  const stop = new Set(["the", "and", "for", "with", "meeting", "call", "sync", "weekly", "review", "team", "about", "from", "into", "this", "that", "our"]);
  return new Set((text || "").toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g)?.filter(w => !stop.has(w)) ?? []);
}

/**
 * Open follow-up tasks that relate to a meeting — matched by shared title keywords. Pure + unit-tested.
 * A task counts once even if it matches several meetings; nothing is invented — an empty set stays empty.
 */
export function relatedFollowUps(events: MeetingLite[], tasks: TaskLite[]): TaskLite[] {
  const meetingTokens = events.flatMap(e => [...titleTokens(e.title ?? "")]);
  if (meetingTokens.length === 0) return [];
  const wanted = new Set(meetingTokens);
  return tasks.filter(t => { const tt = titleTokens(t.title); for (const w of tt) if (wanted.has(w)) return true; return false; });
}

/** Pure detection over a set of meetings — real overlaps + real gaps, no side effects. Unit-tested. */
export function analyzeMeetings(events: MeetingLite[]): MeetingAnalysis {
  const active = events.filter(e => (e.status ?? "scheduled") !== "cancelled" && !Number.isNaN(startMs(e)));
  const sorted = [...active].sort((a, b) => startMs(a) - startMs(b));
  const conflicts: [MeetingLite, MeetingLite][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!, b = sorted[j]!;
      if (startMs(b) >= endMs(a)) break;                 // sorted by start → nothing later overlaps a
      if (startMs(a) < endMs(b) && startMs(b) < endMs(a)) conflicts.push([a, b]);
    }
  }
  const missingAgenda = active.filter(e => !(e.description ?? "").trim());
  const missingCall = active.filter(e => !e.call_url);
  return { active, conflicts, missingAgenda, missingCall };
}

/**
 * Run the Meeting Agent for a workspace: load today + the next 7 days of meetings, analyze them, log
 * the five canonical steps, queue conflict attention items (deduped), and complete the job. Real work,
 * real proof-of-work. Returns the structured counts (also the on-demand /agents/meeting/run payload).
 */
export async function runMeetingAgent(workspaceId: string): Promise<{
  meetings: number; conflicts: number; missing_agenda: number; missing_call_link: number; related_followups: number; queued: number; summary: string;
}> {
  const jobId = await startJob({ workspace_id: workspaceId, agent_name: "meeting", trigger_type: "manual", input: {} });
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const horizon = new Date(start); horizon.setDate(horizon.getDate() + 7);
    const { data } = await supabase.from("nodes").select("id, data")
      .eq("workspace_id", workspaceId).eq("object_type", "calendar_event")
      .gte("data->>start_at", start.toISOString()).lt("data->>start_at", horizon.toISOString())
      .order("data->>start_at", { ascending: true }).limit(500);

    const events: MeetingLite[] = (data ?? []).map((n) => {
      const d = (n.data ?? {}) as Record<string, unknown>;
      return { id: n.id, title: String(d.title ?? ""), start_at: String(d.start_at ?? ""), end_at: String(d.end_at ?? ""), description: String(d.description ?? ""), call_url: (d.call_url as string | null) ?? null, status: String(d.status ?? "scheduled") };
    });
    const a = analyzeMeetings(events);

    // Open follow-up tasks that relate to these meetings (by shared title keywords). Read-only signal —
    // honestly reports 0 when nothing matches (or the tasks table isn't reachable). Never queued/invented.
    let followUps: TaskLite[] = [];
    if (a.active.length > 0) {
      const { data: taskRows } = await supabase.from("tasks").select("id, title")
        .eq("workspace_id", workspaceId).eq("completed", false).limit(500);
      followUps = relatedFollowUps(a.active, (taskRows ?? []).map(r => ({ id: String(r.id), title: String(r.title ?? "") })));
    }

    const steps: AgentStep[] = [
      step(`Loaded ${a.active.length} meeting(s)`, { detail: "today + next 7 days" }),
      step(`Found ${a.conflicts.length} conflict(s)`, { status: a.conflicts.length ? "warn" : "ok" }),
      step(`Found ${a.missingAgenda.length} missing agenda(s)`, { status: a.missingAgenda.length ? "warn" : "ok" }),
      step(`Found ${a.missingCall.length} missing call link(s)`, { status: a.missingCall.length ? "warn" : "ok" }),
      step(`Found ${followUps.length} related follow-up(s)`, { status: followUps.length ? "info" : "ok" }),
    ];

    // Queue Decision Queue items ONLY for real conflicts (a genuine, actionable clash). Deduped so a
    // repeated run never piles up duplicates. Missing agenda/call are surfaced as findings, not forced
    // into the queue (they're not always a required action) — no fabricated attention items.
    let queued = 0;
    for (const [x, y] of a.conflicts) {
      const sourceId = [x.id, y.id].sort().join("__");
      const { data: existing } = await supabase.from("decision_queue").select("id")
        .eq("workspace_id", workspaceId).eq("source_type", "calendar_conflict").eq("source_id", sourceId)
        .eq("agent_name", "meeting").eq("status", "pending").maybeSingle();
      if (existing) continue;
      const { error } = await supabase.from("decision_queue").insert({
        workspace_id: workspaceId, source_type: "calendar_conflict", source_id: sourceId, agent_name: "meeting",
        title: `Overlapping meetings: ${x.title || "Untitled"} & ${y.title || "Untitled"}`,
        summary: `These two meetings overlap in time.`,
        recommended_action: "Reschedule one of the meetings",
        risk_level: "medium",
        evidence: [
          { type: "calendar_event", title: x.title || "Untitled", node_id: x.id, match_reason: "overlaps", timestamp: x.start_at },
          { type: "calendar_event", title: y.title || "Untitled", node_id: y.id, match_reason: "overlaps", timestamp: y.start_at },
        ],
      });
      if (!error) queued++;
    }
    steps.push(step(`Queued ${queued} attention item(s)`, { status: queued ? "warn" : "ok" }));

    const output = {
      meetings: a.active.length, conflicts: a.conflicts.length,
      missing_agenda: a.missingAgenda.length, missing_call_link: a.missingCall.length,
      related_followups: followUps.length, queued,
      summary: `Checked ${a.active.length} meeting(s): ${a.conflicts.length} conflict(s), ${a.missingAgenda.length} without agenda, ${a.missingCall.length} without call link`,
    };
    await completeJob(jobId, output, steps);
    return output;
  } catch (err: unknown) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
