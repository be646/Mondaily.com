import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiClient } from "../../lib/api-client";
import { EmptyState, PageHeader, PageSkeleton } from "../../components/ui/page-state";

interface Notification { id: string; message: string; type: string; record_name?: string; read_at?: string; created_at: string }

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => apiClient.get<Notification[]>("/notifications") });
  const markRead = useMutation({ mutationFn: (id: string) => apiClient.post(`/notifications/${id}/read`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  const markAll = useMutation({ mutationFn: () => apiClient.post("/notifications/read-all", {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  const notifications = query.data ?? [];
  const unread = notifications.filter((item) => !item.read_at).length;
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Notifications" description={`${unread} unread`} action={unread ? <button onClick={() => markAll.mutate()} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white"><Check size={14} /> Mark all read</button> : undefined} />
      {query.isLoading ? <PageSkeleton /> : notifications.length === 0 ? <EmptyState icon={Bell} title="No notifications" description="Agent updates, assignments, and mentions will appear here." /> : (
        <div className="space-y-1">{notifications.map((item) => <button key={item.id} onClick={() => markRead.mutate(item.id)} className={`flex w-full gap-3 rounded-lg border p-4 text-left ${item.read_at ? "border-transparent" : "border-red-500/15 bg-red-500/5"}`}><Sparkles size={15} className="mt-0.5 text-red-400" /><div className="flex-1"><p className="text-sm text-slate-200">{item.message}</p>{item.record_name ? <p className="mt-1 text-xs text-slate-500">{item.record_name}</p> : null}<p className="mt-1 text-xs text-slate-600">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}</p></div></button>)}</div>
      )}
    </div>
  );
}
