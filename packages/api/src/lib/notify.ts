import { supabase } from "@mondaily/db/client";

/**
 * THE single way to create a notification. Previously call sites inlined
 * `supabase.from("notifications").insert({...metadata})` and swallowed the error —
 * but the table had no `metadata` column, so every such insert failed silently
 * (PGRST204) and the bell stayed empty.
 *
 * This helper:
 *  - writes the known-good columns (so it always persists),
 *  - includes `metadata` for deep-linking when present, and if the column doesn't
 *    exist yet, retries WITHOUT it so the notification still lands,
 *  - logs real failures instead of swallowing them.
 */
export interface NotifyInput {
  workspace_id: string;
  user_id?: string | null;
  type?: string;
  title: string;
  body?: string;
  task_id?: string | null;
  record_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function createNotification(n: NotifyInput): Promise<boolean> {
  const base: Record<string, unknown> = {
    workspace_id: n.workspace_id,
    user_id: n.user_id ?? null,
    type: n.type ?? "system",
    title: n.title,
    body: n.body ?? "",
    message: n.title, // legacy NOT-NULL-friendly column
    is_read: false,
    read_at: null,
  };
  if (n.task_id) base.task_id = n.task_id;
  if (n.record_name) base.record_name = n.record_name;

  const hasMeta = n.metadata && Object.keys(n.metadata).length > 0;
  const payload = hasMeta ? { ...base, metadata: n.metadata } : base;

  let { error } = await supabase.from("notifications").insert(payload);
  if (error && /metadata/i.test(error.message)) {
    // metadata column not migrated yet — persist anyway (deep-link added once migrated).
    ({ error } = await supabase.from("notifications").insert(base));
  }
  if (error) {
    console.error("[notify] failed to create notification:", error.message);
    return false;
  }
  return true;
}
