import { inngest } from "../lib/inngest";
import { supabase } from "@mondaily/db/client";
import { buildTrainingExport } from "../scripts/export-training-data";

// Weekly training-data export — Mondays at 4am (after the nightly scoring jobs).
// Compiles every APPROVED ai_training_logs row into validated JSONL and snapshots
// it (+ stats) into training_exports, so the fine-tuning corpus is always ready
// without a manual CLI run. Fully self-contained and fail-safe: a missing table
// or read error is logged and the run still completes (it never throws into the
// retry framework on a transient hiccup).
export const trainingExport = inngest.createFunction(
  { id: "ai-training-export", name: "AI: Weekly training-data export", concurrency: { limit: 1 } },
  { cron: "0 4 * * 1" },
  async () => {
    const r = await buildTrainingExport();

    const { error } = await supabase.from("training_exports").insert({
      example_count: r.exampleCount,
      approved_rows: r.approvedRows,
      total_tokens: r.totalTokens,
      avg_tokens: r.avgTokens,
      excluded: r.excluded,
      jsonl: r.jsonl,
    });
    if (error) {
      // Non-fatal: the compile worked; only the snapshot insert failed (e.g. the
      // training_exports migration isn't applied yet). Log and move on.
      console.error("[training-export] snapshot insert failed (non-fatal):", error.message);
    }

    console.log(
      `[training-export] ${r.exampleCount} example(s), ~${r.totalTokens} tokens; ` +
      `excluded injection:${r.excluded.injection} empty:${r.excluded.empty} oversized:${r.excluded.oversized}`,
    );
    return { example_count: r.exampleCount, total_tokens: r.totalTokens, excluded: r.excluded };
  },
);
