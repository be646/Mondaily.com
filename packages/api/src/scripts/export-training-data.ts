/**
 * Export Engine — AI Training Data
 *
 * Reads every human-APPROVED row from `ai_training_logs` and writes a
 * validation-ready JSONL (JSON Lines) artifact in OpenAI/instruction-tuning
 * chat format — one training example per line:
 *
 *   {"agent":"prospecting","messages":[{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}
 *
 * Where a human edited the recommendation before approving, the EDITED output is
 * used as the gold completion (it's the human-corrected target). Otherwise the
 * model's original output is the completion.
 *
 * Usage (standalone — needs SUPABASE env + the migration applied):
 *   pnpm --filter @mondaily/api exec tsx src/scripts/export-training-data.ts [outfile]
 *
 * Default output: ./training-data.jsonl (a placeholder file is still written when
 * there are zero approved rows yet, so the artifact is ready for the first run).
 */
import { writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { supabase } from "@mondaily/db/client";

interface TrainingRow {
  agent_name: string | null;
  system_prompt: string | null;
  user_prompt: string | null;
  model_output: unknown;
  edited_output: unknown;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function asContent(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toJsonlLine(row: TrainingRow): string {
  // Human-edited output wins as the gold completion when present.
  const completion = row.edited_output ?? row.model_output;
  const messages: ChatMessage[] = [];
  if (row.system_prompt) messages.push({ role: "system", content: row.system_prompt });
  messages.push({ role: "user", content: row.user_prompt ?? "" });
  messages.push({ role: "assistant", content: asContent(completion) });
  return JSON.stringify({ agent: row.agent_name ?? "unknown", messages });
}

async function main(): Promise<void> {
  const outPath = resolvePath(process.argv[2] ?? "training-data.jsonl");
  const pageSize = 1000;
  const rows: TrainingRow[] = [];

  // Page through every APPROVED example.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ai_training_logs")
      .select("agent_name, system_prompt, user_prompt, model_output, edited_output")
      .eq("user_action", "APPROVED")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed reading ai_training_logs: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as TrainingRow[]));
    if (data.length < pageSize) break;
  }

  const lines = rows.map(toJsonlLine);
  // Always write the file (empty placeholder when there's nothing yet).
  writeFileSync(outPath, lines.length ? lines.join("\n") + "\n" : "", "utf8");
  console.log(`[export-training-data] wrote ${lines.length} approved example(s) → ${outPath}`);
}

main().catch((err) => {
  console.error("[export-training-data] failed:", err);
  process.exit(1);
});
