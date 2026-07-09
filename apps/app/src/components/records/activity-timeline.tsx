import { useQuery } from "@tanstack/react-query";
import { X, Activity, User, Zap, Settings } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { apiClient } from "../../lib/api-client";

interface ActivityItem {
  id: string;
  node_id: string;
  workspace_id: string;
  actor_type: "human" | "ai_agent" | "integration" | "system";
  actor_id: string | null;
  action: string;
  diff: Record<string, unknown> | null;
  ai_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function actorIcon(type: string) {
  switch (type) {
    case "ai_agent": return <LogoMark size={10} className="text-stone-400" />;
    case "integration": return <Zap size={10} className="text-[#97824f]" />;
    case "system": return <Settings size={10} className="text-stone-500" />;
    default: return <User size={10} className="text-[#717784]" />;
  }
}

function actionColor(action: string) {
  if (action === "created") return "text-[#5f8169]";
  if (action === "deleted") return "text-stone-400";
  if (action === "enriched") return "text-stone-400";
  return "text-stone-400";
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityTimeline({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["activities", nodeId],
    queryFn: () => apiClient.get<ActivityItem[]>(`/activities/node/${nodeId}`),
    refetchInterval: 30000,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 backdrop-blur-[1px] p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm h-[70vh] rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-stone-400" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">Activity</span>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)]"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-6 w-6 rounded-full bg-[var(--surface-hover)] flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-[var(--surface-hover)] rounded w-3/4" />
                    <div className="h-2.5 bg-[var(--surface-hover)] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : !activities?.length ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="h-10 w-10 rounded-sm bg-[var(--surface-hover)] flex items-center justify-center">
                <Activity size={18} className="text-[var(--text-secondary)]" />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">No activity yet</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-[11px] top-0 bottom-0 w-px bg-[var(--surface-hover)]" />
              <div className="space-y-4">
                {activities.map(item => (
                  <div key={item.id} className="flex gap-3 relative">
                    <div className="h-6 w-6 rounded-full border border-[var(--border-soft)] bg-[var(--surface-card)] flex items-center justify-center flex-shrink-0 z-10">
                      {actorIcon(item.actor_type)}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-medium capitalize ${actionColor(item.action)}`}>{item.action}</span>
                        {item.ai_summary && (
                          <span className="text-[11px] text-[var(--text-secondary)] truncate">{item.ai_summary}</span>
                        )}
                      </div>
                      {item.diff && Object.keys(item.diff).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.keys(item.diff).slice(0, 4).map(k => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--surface-hover)] text-[var(--text-secondary)]">{k}</span>
                          ))}
                          {Object.keys(item.diff).length > 4 && (
                            <span className="text-[10px] text-[var(--text-secondary)]">+{Object.keys(item.diff).length - 4}</span>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1">{fmtTime(item.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
