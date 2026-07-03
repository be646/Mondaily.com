import { supabase } from "@mondaily/db/client";

export interface AgentJobInit {
  workspace_id: string;
  agent_name: string;
  trigger_type: "manual" | "scheduled" | "webhook" | "signal" | "ask";
  input: Record<string, unknown>;
  node_ids?: string[];
}

/**
 * Canonical proof-of-work step. Every agent step normalizes to this shape so the Control Room
 * timeline can render "what the agent actually did, when, and what it read" consistently —
 * regardless of which agent logged it. `at` is auto-stamped; `sources` is the proof-of-work
 * (the real records / URLs the agent looked at) and stays empty rather than fabricated.
 */
export interface AgentStep {
  label: string;                              // human-readable: "Scanned 42 deals"
  status: "ok" | "warn" | "error" | "info";   // tone for the timeline dot
  at: string;                                  // ISO timestamp
  detail?: string;                             // optional one-line specifics
  sources?: { title: string; url?: string; node_id?: string }[]; // what it read (proof)
}

/** Build a structured step with an auto timestamp. Use inside agents:
 *  `steps.push(step("Scanned 42 deals", { detail: "3 flagged at-risk" }))`. */
export function step(
  label: string,
  extra?: { status?: AgentStep["status"]; detail?: string; sources?: AgentStep["sources"] },
): AgentStep {
  return { label, status: extra?.status ?? "ok", at: new Date().toISOString(), detail: extra?.detail, sources: extra?.sources };
}

/**
 * Normalize ANY historical step value into an AgentStep. Older agents logged freeform objects
 * (e.g. {invoice_id, days_overdue}) or plain strings; this coerces them so the API always emits
 * a clean, renderable shape without losing the original data (kept in `detail`).
 */
export function normalizeStep(raw: unknown): AgentStep {
  if (raw && typeof raw === "object" && typeof (raw as AgentStep).label === "string") {
    const s = raw as AgentStep;
    return { label: s.label, status: s.status ?? "ok", at: typeof s.at === "string" ? s.at : "", detail: s.detail, sources: Array.isArray(s.sources) ? s.sources : undefined };
  }
  if (typeof raw === "string") return { label: raw, status: "info", at: "" };
  if (raw && typeof raw === "object") {
    // Freeform object from a legacy agent — summarize its keys as the label, keep the raw as detail.
    const obj = raw as Record<string, unknown>;
    const label = Object.entries(obj)
      .filter(([, v]) => v != null && typeof v !== "object")
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(" · ") || "step";
    return { label, status: "info", at: "", detail: undefined };
  }
  return { label: "step", status: "info", at: "" };
}

export async function startJob(init: AgentJobInit): Promise<string> {
  const { data } = await supabase
    .from("agent_jobs")
    .insert({ ...init, status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();
  return data?.id ?? "";
}

export async function completeJob(
  id: string,
  output: Record<string, unknown>,
  steps: unknown[] = [],
): Promise<void> {
  await supabase
    .from("agent_jobs")
    .update({ status: "completed", output, steps, completed_at: new Date().toISOString() })
    .eq("id", id);
}

export async function failJob(id: string, error: string): Promise<void> {
  await supabase
    .from("agent_jobs")
    .update({ status: "failed", error, completed_at: new Date().toISOString() })
    .eq("id", id);
}

/** Append one step to a running job. Accepts a structured AgentStep (preferred) or any legacy
 *  value (normalized on read). A bare string/object gets an auto timestamp so live-running jobs
 *  still show real timing. */
export async function logStep(id: string, rawStep: unknown): Promise<void> {
  const stepToStore =
    rawStep && typeof rawStep === "object" && typeof (rawStep as AgentStep).label === "string"
      ? { ...(rawStep as AgentStep), at: (rawStep as AgentStep).at ?? new Date().toISOString() }
      : rawStep;
  const { data } = await supabase.from("agent_jobs").select("steps").eq("id", id).single();
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  await supabase.from("agent_jobs").update({ steps: [...steps, stepToStore] }).eq("id", id);
}
