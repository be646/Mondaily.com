import { supabase } from "@mondaily/db/client";
import { sendTransactionalEmail } from "./mail";

const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] ?? ch));

/**
 * Resolve a user's notification channel preferences for a given type. Per-type override
 * (settings.user_preferences[uid].notifications[type].{in_app,email}) wins; else the master
 * email_notifications toggle for email. Both default ON. Workspace-wide notices (no user_id)
 * always render in-app and never email (so they can't mass-mail the whole team).
 */
async function channelPrefs(n: NotifyInput): Promise<{ inApp: boolean; email: boolean; to?: string; name?: string }> {
  if (!n.user_id) return { inApp: true, email: false };
  try {
    const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", n.workspace_id).maybeSingle();
    const prefs = ((((ws?.settings ?? {}) as Record<string, unknown>).user_preferences as Record<string, Record<string, unknown>> | undefined)?.[n.user_id] ?? {});
    const perType = (prefs.notifications as Record<string, { in_app?: boolean; email?: boolean }> | undefined)?.[n.type ?? "system"];
    const inApp = perType?.in_app ?? true;
    const email = perType?.email ?? (prefs.email_notifications as boolean | undefined) ?? true;
    let to: string | undefined, name: string | undefined;
    if (email) {
      const { data: member } = await supabase.from("workspace_members").select("email, name").eq("workspace_id", n.workspace_id).eq("user_id", n.user_id).maybeSingle();
      to = (member?.email as string) || undefined;
      name = (member?.name as string) || undefined;
    }
    return { inApp, email, to, name };
  } catch {
    return { inApp: true, email: false };
  }
}

function emailNotification(n: NotifyInput, to: string, name?: string): void {
  void sendTransactionalEmail({
    to: [{ email: to, name }],
    subject: n.title,
    body: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
      <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 8px">${escapeHtml(n.title)}</p>
      ${n.body ? `<p style="font-size:14px;color:#444;margin:0 0 16px">${escapeHtml(n.body)}</p>` : ""}
      <a href="${appUrl()}/notifications" style="display:inline-block;font-size:13px;color:#16a34a;text-decoration:none">Open in Mondaily →</a>
    </div>`,
  }).catch(() => {});
}

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
/**
 * Where a notification came from — the audit trail. Every field is OPTIONAL and only ever set to a
 * real id the caller already has (an agent that actually ran, a decision that was actually queued).
 * Nothing here is fabricated: an unknown source stays undefined rather than guessed.
 */
export interface NotificationSource {
  source_agent?: string | null;   // canonical agent slug that caused it (e.g. "relationship", "asset")
  agent_job_id?: string | null;   // the agent_jobs run — links a notification to its proof-of-work
  decision_id?: string | null;    // the decision_queue row the user can act on
  task_id?: string | null;
  node_id?: string | null;        // the graph record it's about
  object_type?: string | null;
  route?: string | null;          // explicit deep-link override
}

export interface NotifyInput {
  workspace_id: string;
  user_id?: string | null;
  type?: string;
  title: string;
  body?: string;
  task_id?: string | null;
  record_name?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Structured provenance — folded into metadata so the bell can show who/what/where + deep-link. */
  source?: NotificationSource | null;
}

/** The five notification groups the bell renders. */
export type NotificationCategory = "agent" | "decisions" | "messages" | "tasks" | "system";

/** Drop null/undefined/empty-string entries so we never persist a fabricated/blank source field. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== "") out[k] = v;
  return out;
}

/**
 * Categorize a notification into one of the five bell groups, deterministically from its type +
 * source. Precedence: messages → decisions (something to approve) → tasks → agent findings → system.
 * Pure + exported so it's unit-tested and reused server-side in GET /notifications.
 */
export function categorizeNotification(row: { type?: string | null; task_id?: string | null; metadata?: Record<string, unknown> | null }): NotificationCategory {
  const type = (row.type ?? "system").toLowerCase();
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const has = (k: string) => m[k] != null && m[k] !== "";
  if (type === "message") return "messages";
  if (type === "decision" || type === "alert" || has("decision_id")) return "decisions";
  if (type === "task" || row.task_id || has("task_id")) return "tasks";
  if (type === "agent" || has("source_agent")) return "agent";
  return "system";
}

/** Extract the compacted source object from a persisted row (metadata + top-level task_id). */
export function extractSource(row: { task_id?: string | null; metadata?: Record<string, unknown> | null }): NotificationSource {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const pick = (a: string, b?: string) => (m[a] ?? (b ? m[b] : undefined)) as string | undefined;
  return compact({
    source_agent: pick("source_agent"),
    agent_job_id: pick("agent_job_id"),
    decision_id: pick("decision_id", "decisionId"),
    task_id: row.task_id ?? pick("task_id"),
    node_id: pick("node_id", "nodeId"),
    object_type: pick("object_type", "objectType"),
    route: pick("route"),
  }) as NotificationSource;
}

/**
 * Build the notifications insert row from a NotifyInput — pure so it's unit-tested. Folds the
 * structured `source` into metadata (never overwriting an explicit metadata key the caller set),
 * always stamps workspace_id + is_read:false (preserves read/unread behavior), and lifts
 * source.task_id up to the top-level column for the existing deep-link resolver.
 */
export function buildNotificationPayload(n: NotifyInput): Record<string, unknown> {
  const source = n.source ? compact({ ...n.source }) : {};
  const metadata = { ...source, ...(n.metadata ?? {}) }; // explicit metadata wins over source
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
  const taskId = n.task_id ?? n.source?.task_id ?? null;
  if (taskId) base.task_id = taskId;
  if (n.record_name) base.record_name = n.record_name;
  return Object.keys(metadata).length > 0 ? { ...base, metadata } : base;
}

export async function createNotification(n: NotifyInput): Promise<boolean> {
  // Resolve the operator's channel prefs once — gate BOTH the in-app row and the email on them.
  const ch = await channelPrefs(n);

  // Email channel (independent of in-app).
  if (ch.email && ch.to) emailNotification(n, ch.to, ch.name);

  // In-app channel — honor the toggle: if the operator turned in-app OFF for this type, skip it.
  if (!ch.inApp) return true;

  const payload = buildNotificationPayload(n);

  let { error } = await supabase.from("notifications").insert(payload);
  if (error && /metadata/i.test(error.message)) {
    // metadata column not migrated yet — persist anyway (deep-link added once migrated).
    const { metadata: _dropped, ...base } = payload;
    ({ error } = await supabase.from("notifications").insert(base));
  }
  if (error) {
    console.error("[notify] failed to create notification:", error.message);
    return false;
  }
  return true;
}
