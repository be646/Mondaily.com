import { supabase } from "@mondaily/db/client";

/**
 * Read state for notifications.
 *
 * Two kinds of notification live in one table and they do not share a definition of "read":
 *
 *  - PERSONAL (`user_id` set) has exactly one reader, so `is_read` on the row is correct and stays.
 *  - BROADCAST (`user_id IS NULL`) is addressed to the whole workspace. Its read state was ALSO
 *    kept in `is_read` on the single shared row, so the first member to open the bell marked it
 *    read for everyone and the rest of the team silently lost a notification they were meant to
 *    see. Nothing errored; it simply was not there any more.
 *
 * Every surface that reads or writes notification state goes through this module, so the two kinds
 * cannot drift apart again — the previous bug existed in the canonical router AND in app-data,
 * fixed in one and not the other.
 */

interface NotificationRow {
  id: string;
  user_id?: string | null;
  is_read?: boolean | null;
  read_at?: string | null;
  [k: string]: unknown;
}

/**
 * Overlay each row's read state for THIS reader.
 *
 * A broadcast row's stored `is_read` is meaningless per-reader, so it is replaced outright rather
 * than OR-ed with the per-user record: honouring a legacy `true` there would reproduce exactly the
 * bug this fixes, for every notification that was already wrongly marked.
 */
export async function withReadState<T extends NotificationRow>(rows: T[], userId: string): Promise<T[]> {
  const broadcastIds = rows.filter(r => r.user_id == null).map(r => r.id);
  if (broadcastIds.length === 0) return rows;

  const { data, error } = await supabase
    .from("notification_reads")
    .select("notification_id, read_at")
    .eq("user_id", userId)
    .in("notification_id", broadcastIds);

  // A failed lookup must not read as "everything is unread" OR as "everything is read". Unread is
  // the safe direction: the worst case is a notification shown twice, not one never shown.
  if (error) return rows.map(r => (r.user_id == null ? { ...r, is_read: false, read_at: null } : r));

  const readAt = new Map((data ?? []).map(r => [String(r.notification_id), String(r.read_at)]));
  return rows.map(r => {
    if (r.user_id != null) return r;
    const at = readAt.get(r.id);
    return { ...r, is_read: at != null, read_at: at ?? null };
  });
}

/**
 * Mark one notification read for this user.
 *
 * Returns false when the notification does not exist, or is addressed to somebody else — the
 * caller reports that as a 404 rather than silently succeeding on a row it never touched.
 */
export async function markRead(workspaceId: string, userId: string, notificationId: string): Promise<boolean> {
  const { data: row } = await supabase
    .from("notifications")
    .select("id, user_id")
    .eq("id", notificationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row) return false;

  if (row.user_id == null) {
    // Idempotent: opening the bell twice must not fail on the primary key.
    const { error } = await supabase
      .from("notification_reads")
      .upsert({ notification_id: notificationId, user_id: userId }, { onConflict: "notification_id,user_id" });
    return !error;
  }

  if (row.user_id !== userId) return false;
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  return !error;
}

/** Mark every notification this user can see as read — their own rows, and the broadcasts, for them only. */
export async function markAllRead(workspaceId: string, userId: string): Promise<boolean> {
  const mine = await supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("is_read", false);
  if (mine.error) return false;

  const { data: broadcasts, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("user_id", null);
  if (error) return false;
  if (!broadcasts?.length) return true;

  const { error: insErr } = await supabase
    .from("notification_reads")
    .upsert(broadcasts.map(b => ({ notification_id: b.id, user_id: userId })), { onConflict: "notification_id,user_id" });
  return !insErr;
}

/** Unread count for this user, counting broadcasts by THEIR read state rather than the shared row's. */
export async function unreadCount(workspaceId: string, userId: string): Promise<number> {
  const [mine, broadcasts, reads] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("user_id", userId).eq("is_read", false),
    supabase.from("notifications").select("id").eq("workspace_id", workspaceId).is("user_id", null),
    supabase.from("notification_reads").select("notification_id").eq("user_id", userId),
  ]);
  const readIds = new Set((reads.data ?? []).map(r => String(r.notification_id)));
  const unreadBroadcasts = (broadcasts.data ?? []).filter(b => !readIds.has(String(b.id))).length;
  return (mine.count ?? 0) + unreadBroadcasts;
}
