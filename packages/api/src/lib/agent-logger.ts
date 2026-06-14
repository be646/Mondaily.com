import { supabase } from "@mondaily/db/client";

export interface AgentJobInit {
  workspace_id: string;
  agent_name: string;
  trigger_type: "manual" | "scheduled" | "webhook" | "signal" | "ask";
  input: Record<string, unknown>;
  node_ids?: string[];
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

export async function logStep(id: string, step: unknown): Promise<void> {
  const { data } = await supabase.from("agent_jobs").select("steps").eq("id", id).single();
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  await supabase.from("agent_jobs").update({ steps: [...steps, step] }).eq("id", id);
}
