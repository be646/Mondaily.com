import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Tag, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";

interface TagData { id: string; name: string; color: string }

const PRESET_COLORS = [
  "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6",
  "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
];

export function TagPicker({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]!);
  const [creating, setCreating] = useState(false);

  const allTags = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiClient.get<TagData[]>("/tags"),
  });

  const nodeTags = useQuery({
    queryKey: ["node-tags", nodeId],
    queryFn: () => apiClient.get<TagData[]>(`/tags/node/${nodeId}`),
  });

  const nodeTagIds = new Set((nodeTags.data ?? []).map(t => t.id));

  const addTag = useMutation({
    mutationFn: (tag_id: string) => apiClient.post(`/tags/node/${nodeId}`, { tag_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["node-tags", nodeId] }); },
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) => apiClient.delete(`/tags/node/${nodeId}/${tagId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["node-tags", nodeId] }); },
  });

  async function createAndAdd() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const tag = await apiClient.post<TagData>("/tags", { name: newName.trim(), color: newColor });
      await apiClient.post(`/tags/node/${nodeId}`, { tag_id: tag.id });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["node-tags", nodeId] });
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl border border-white/[.08] bg-[#0f1117] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[.06]">
          <div className="flex items-center gap-2">
            <Tag size={13} className="text-violet-400" />
            <span className="text-sm font-semibold text-white">Tags</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/70"><X size={14} /></button>
        </div>

        <div className="p-3 space-y-1 max-h-52 overflow-y-auto">
          {(allTags.data ?? []).map(tag => {
            const active = nodeTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => active ? removeTag.mutate(tag.id) : addTag.mutate(tag.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-white/[.04] transition-colors"
              >
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="flex-1 text-left text-xs text-white/70">{tag.name}</span>
                {active && <Check size={11} className="text-violet-400" />}
              </button>
            );
          })}
          {(allTags.data ?? []).length === 0 && (
            <p className="text-xs text-white/20 text-center py-3">No tags yet — create one below</p>
          )}
        </div>

        <div className="px-3 pb-3 border-t border-white/[.06] pt-3 space-y-2">
          <div className="flex gap-1.5">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className="h-4 w-4 rounded-full flex-shrink-0 ring-offset-[#0f1117] transition-all"
                style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px #0f1117, 0 0 0 3px ${c}` : undefined }}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createAndAdd()}
              placeholder="New tag name…"
              className="flex-1 h-8 rounded-lg border border-white/[.07] bg-[#0d0f13] px-2.5 text-xs text-white/80 placeholder-white/20 outline-none focus:border-violet-500/40"
            />
            <button
              onClick={createAndAdd}
              disabled={!newName.trim() || creating}
              className="h-8 w-8 grid place-items-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TagBadges({ nodeId }: { nodeId: string }) {
  const { data: tags } = useQuery({
    queryKey: ["node-tags", nodeId],
    queryFn: () => apiClient.get<TagData[]>(`/tags/node/${nodeId}`),
  });
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(tag => (
        <span key={tag.id} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}33` }}>
          {tag.name}
        </span>
      ))}
    </div>
  );
}
