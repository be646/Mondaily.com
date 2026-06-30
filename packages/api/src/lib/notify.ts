import { supabase } from "@mondaily/db/client";
import { sendTransactionalEmail } from "./mail";

const appUrl = () => (process.env.APP_URL ?? "https://app.mondaily.com").replace(/\/$/, "");
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch] ?? ch));

/**
 * Best-effort email fan-out for a notification. Only fires for TARGETED notifications (a specific
 * user_id) so workspace-wide notices never mass-email. Honors the user's saved preference:
 * a per-type override (settings.user_preferences[uid].notifications[type].email) if present, else
 * the master email_notifications toggle (default on). Never throws.
 */
async function maybeEmailNotification(n: NotifyInput): Promise<void> {
  try {
    if (!n.user_id) return;
    const { data: ws } = await supabase.from("workspaces").select("settings").eq("id", n.workspace_id).maybeSingle();
    const prefs = ((((ws?.settings ?? {}) as Record<string, unknown>).user_preferences as Record<string, Record<string, unknown>> | undefined)?.[n.user_id] ?? {});
    const perType = (prefs.notifications as Record<string, { email?: boolean }> | undefined)?.[n.type ?? "system"]?.email;
    const emailEnabled = perType !== undefined ? perType : (prefs.email_notifications ?? true);
    if (!emailEnabled) return;

    const { data: member } = await supabase.from("workspace_members").select("email, name").eq("workspace_id", n.workspace_id).eq("user_id", n.user_id).maybeSingle();
    const to = member?.email as string | undefined;
    if (!to) return;

    await sendTransactionalEmail({
      to: [{ email: to, name: (member?.name as string) || undefined }],
      subject: n.title,
      body: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px">
        <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 8px">${escapeHtml(n.title)}</p>
        ${n.body ? `<p style="font-size:14px;color:#444;margin:0 0 16px">${escapeHtml(n.body)}</p>` : ""}
        <a href="${appUrl()}/notifications" style="display:inline-block;font-size:13px;color:#16a34a;text-decoration:none">Open in Mondaily →</a>
      </div>`,
    });
  } catch { /* email is best-effort — never block the in-app notification */ }
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
  void maybeEmailNotification(n); // fan out to email per the user's preference (best-effort)
  return true;
}
