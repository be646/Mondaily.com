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
  // Resolve the operator's channel prefs once — gate BOTH the in-app row and the email on them.
  const ch = await channelPrefs(n);

  // Email channel (independent of in-app).
  if (ch.email && ch.to) emailNotification(n, ch.to, ch.name);

  // In-app channel — honor the toggle: if the operator turned in-app OFF for this type, skip it.
  if (!ch.inApp) return true;

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
