import { useQuery } from "@tanstack/react-query";
import { X, Activity, Sparkles, User, Zap, Settings } from "lucide-react";
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
    case "ai_agent": return <Sparkles size={10} className="text-violet-400" />;
    case "integration": return <Zap size={10} className="text-amber-400" />;
    case "system": return <Settings size={10} className="text-stone-500" />;
    default: return <User size={10} className="text-blue-400" />;
  }
}

function actionColor(action: string) {
  if (action === "created") return "text-emerald-400";
  if (action === "deleted") return "text-stone-400";
  if (action === "enriched") return "text-violet-400";
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
        className="w-full max-w-sm h-[70vh] rounded-2xl border border-white/[.08] bg-[#0f1117] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-stone-400" />
            <span className="text-sm font-semibold text-white">Activity</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70"><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-6 w-6 rounded-full bg-white/[.05] flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-white/[.05] rounded w-3/4" />
                    <div className="h-2.5 bg-white/[.03] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : !activities?.length ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="h-10 w-10 rounded-xl bg-white/[.03] flex items-center justify-center">
                <Activity size={18} className="text-white/20" />
              </div>
              <p className="text-xs text-white/30">No activity yet</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-[11px] top-0 bottom-0 w-px bg-white/[.05]" />
              <div className="space-y-4">
                {activities.map(item => (
                  <div key={item.id} className="flex gap-3 relative">
                    <div className="h-6 w-6 rounded-full border border-white/[.08] bg-[#141414] flex items-center justify-center flex-shrink-0 z-10">
                      {actorIcon(item.actor_type)}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-medium capitalize ${actionColor(item.action)}`}>{item.action}</span>
                        {item.ai_summary && (
                          <span className="text-[11px] text-white/40 truncate">{item.ai_summary}</span>
                        )}
                      </div>
                      {item.diff && Object.keys(item.diff).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.keys(item.diff).slice(0, 4).map(k => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[.04] text-white/30">{k}</span>
                          ))}
                          {Object.keys(item.diff).length > 4 && (
                            <span className="text-[10px] text-white/20">+{Object.keys(item.diff).length - 4}</span>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-white/20 mt-1">{fmtTime(item.created_at)}</p>
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
