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
import { sanitizeForTraining, looksLikeInjection } from "../lib/sanitize";

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

// SECURITY (LLM03 training-data poisoning): an APPROVED row could carry broken
// formatting or an injection vector. We (a) strip control chars / normalize so a
// malformed string can't corrupt the JSONL, and (b) EXCLUDE rows whose prompt
// carries a known prompt-injection pattern so they never become a fine-tuning
// target. Exclusions are counted + logged — never silently dropped.
function rawText(row: TrainingRow): string {
  const out = typeof row.model_output === "string" ? row.model_output : JSON.stringify(row.model_output ?? "");
  return `${row.user_prompt ?? ""}\n${out}`;
}

function asContent(value: unknown): string {
  if (value == null) return "";
  return sanitizeForTraining(typeof value === "string" ? value : JSON.stringify(value));
}

// Token-length bounds for a usable instruction-tuning example. A single example
// far past this is almost certainly malformed (runaway/garbage) and would skew a
// fine-tune; an empty user OR assistant side has no signal. ~4 chars/token is the
// standard rough estimate.
const MAX_EXAMPLE_TOKENS = 8000;
const estimateTokens = (s: string): number => Math.ceil(s.length / 4);

function buildMessages(row: TrainingRow): ChatMessage[] {
  // Human-edited output wins as the gold completion when present.
  const completion = row.edited_output ?? row.model_output;
  const messages: ChatMessage[] = [];
  const sys = sanitizeForTraining(row.system_prompt ?? "");
  if (sys) messages.push({ role: "system", content: sys });
  messages.push({ role: "user", content: sanitizeForTraining(row.user_prompt ?? "") });
  messages.push({ role: "assistant", content: asContent(completion) });
  return messages;
}

type Validation =
  | { ok: true; tokens: number }
  | { ok: false; reason: "empty" | "oversized"; tokens: number };

function validateExample(messages: ChatMessage[]): Validation {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const assistant = messages.find((m) => m.role === "assistant")?.content ?? "";
  const tokens = messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (!user.trim() || !assistant.trim()) return { ok: false, reason: "empty", tokens };
  if (tokens > MAX_EXAMPLE_TOKENS) return { ok: false, reason: "oversized", tokens };
  return { ok: true, tokens };
}

export interface TrainingExport {
  jsonl: string;
  exampleCount: number;
  totalTokens: number;
  avgTokens: number;
  approvedRows: number;
  excluded: { injection: number; empty: number; oversized: number };
}

/**
 * Reusable compile step — paged read of every APPROVED row, validated and
 * filtered into pristine JSONL. Shared by the CLI (`main`) and the weekly
 * Inngest job (`jobs/training-export.ts`). Pure: returns the artifact + stats,
 * writes nothing itself.
 */
export async function buildTrainingExport(): Promise<TrainingExport> {
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

  // Compile each approved row into a pristine, validated training example.
  // Every exclusion is bucketed by reason — never a silent drop:
  //   • injection — prompt-injection / poisoning pattern (LLM03)
  //   • empty     — no usable user OR assistant signal
  //   • oversized — runaway length that would skew the fine-tune
  const excluded = { injection: 0, empty: 0, oversized: 0 };
  let totalTokens = 0;
  const lines: string[] = [];

  for (const row of rows) {
    if (looksLikeInjection(rawText(row))) { excluded.injection++; continue; }
    const messages = buildMessages(row);
    const v = validateExample(messages);
    if (!v.ok) { excluded[v.reason]++; continue; }
    totalTokens += v.tokens;
    lines.push(JSON.stringify({ agent: row.agent_name ?? "unknown", messages }));
  }

  return {
    jsonl: lines.length ? lines.join("\n") + "\n" : "",
    exampleCount: lines.length,
    totalTokens,
    avgTokens: lines.length ? Math.round(totalTokens / lines.length) : 0,
    approvedRows: rows.length,
    excluded,
  };
}

async function main(): Promise<void> {
  const outPath = resolvePath(process.argv[2] ?? "training-data.jsonl");
  const r = await buildTrainingExport();

  // Always write the file (empty placeholder when there's nothing yet).
  writeFileSync(outPath, r.jsonl, "utf8");

  const totalExcluded = r.excluded.injection + r.excluded.empty + r.excluded.oversized;
  console.log(
    `[export-training-data] wrote ${r.exampleCount} clean example(s) ` +
    `(~${r.totalTokens.toLocaleString()} tokens, avg ${r.avgTokens}/example) → ${outPath}`,
  );
  console.log(
    `[export-training-data] excluded ${totalExcluded} of ${r.approvedRows} approved row(s) — ` +
    `injection: ${r.excluded.injection}, empty: ${r.excluded.empty}, oversized: ${r.excluded.oversized}`,
  );
}

// Only run as a CLI when invoked directly (tsx src/scripts/export-training-data.ts).
// Importing buildTrainingExport from the job must NOT trigger the CLI/process.exit.
if (process.argv[1] && process.argv[1].includes("export-training-data")) {
  main().catch((err) => {
    console.error("[export-training-data] failed:", err);
    process.exit(1);
  });
}
