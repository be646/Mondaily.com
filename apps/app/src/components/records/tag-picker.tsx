import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Tag, Check } from "lucide-react";
import { apiClient } from "../../lib/api-client";

interface TagData { id: string; name: string; color: string }

const PRESET_COLORS = [
  "var(--accent)", "#ec4899", "#97824f", "#5f8169", "#717784",
  "#9c6b72", "var(--accent)", "var(--accent)", "#f97316", "#84cc16",
];

export function TagPicker({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]!);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-tags", nodeId] }),
    onError: (e: Error) => setError(e.message),
  });

  const removeTag = useMutation({
    mutationFn: (tagId: string) => apiClient.delete(`/tags/node/${nodeId}/${tagId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node-tags", nodeId] }),
  });

  async function createAndAdd() {
    const name = search.trim(); if (!name) return;
    setCreating(true); setError(null);
    try {
      const tag = await apiClient.post<TagData>("/tags", { name, color: newColor });
      await apiClient.post(`/tags/node/${nodeId}`, { tag_id: tag.id });
      qc.invalidateQueries({ queryKey: ["tags"] });
      qc.invalidateQueries({ queryKey: ["node-tags", nodeId] });
      setSearch("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create tag");
    } finally {
      setCreating(false);
    }
  }

  const filtered = (allTags.data ?? []).filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );
  const canCreate = search.trim() && !(allTags.data ?? []).some(
    t => t.name.toLowerCase() === search.trim().toLowerCase()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-stone-500/20 flex items-center justify-center">
              <Tag size={12} className="text-stone-400"/>
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Tags</span>
            {nodeTags.data && nodeTags.data.length > 0 && (
              <span className="rounded-full bg-stone-500/20 px-2 py-0.5 text-[10px] font-semibold text-stone-300">{nodeTags.data.length}</span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors"><X size={14}/></button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3 pb-1">
          <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && canCreate) createAndAdd(); if (e.key === "Escape") onClose(); }}
            placeholder="Search or create tag…"
            className="w-full bg-[var(--surface-hover)] border border-[var(--border-soft)] rounded-sm px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-stone-500/40 placeholder:text-[var(--text-secondary)] transition-colors"/>
        </div>

        {/* Active tags */}
        {(nodeTags.data ?? []).length > 0 && (
          <div className="px-3 pb-1">
            <div className="flex flex-wrap gap-1 pt-1">
              {(nodeTags.data ?? []).map(tag => (
                <span key={tag.id} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium"
                  style={{ background: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}44` }}>
                  {tag.name}
                  <button onClick={() => removeTag.mutate(tag.id)} className="opacity-60 hover:opacity-100 transition-opacity"><X size={9}/></button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tag list */}
        <div className="p-1 max-h-44 overflow-y-auto">
          {allTags.isLoading && <p className="text-xs text-[var(--text-secondary)] text-center py-4">Loading…</p>}
          {allTags.isError && (
            <p className="text-xs text-stone-400/70 text-center py-3 px-2">{(allTags.error as Error).message}</p>
          )}
          {filtered.map(tag => {
            const active = nodeTagIds.has(tag.id);
            return (
              <button key={tag.id} onClick={() => active ? removeTag.mutate(tag.id) : addTag.mutate(tag.id)}
                className="flex w-full items-center gap-2.5 rounded-sm px-3 py-2 hover:bg-[var(--surface-hover)] transition-colors">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }}/>
                <span className="flex-1 text-left text-xs text-[var(--text-secondary)]">{tag.name}</span>
                {active
                  ? <Check size={11} className="text-stone-400 shrink-0"/>
                  : <Plus size={11} className="text-[var(--text-secondary)] shrink-0"/>
                }
              </button>
            );
          })}
          {filtered.length === 0 && !canCreate && !allTags.isLoading && (
            <p className="text-xs text-[var(--text-secondary)] text-center py-3">
              {search ? "No matching tags" : "No tags yet — type to create one"}
            </p>
          )}
        </div>

        {/* Create new tag */}
        {canCreate && (
          <div className="border-t border-[var(--border-soft)] px-3 py-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Pick a color</p>
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)}
                  className="h-5 w-5 rounded-full shrink-0 transition-all"
                  style={{ backgroundColor: c, boxShadow: newColor === c ? `0 0 0 2px #121214, 0 0 0 3.5px ${c}` : undefined }}/>
              ))}
            </div>
            <button onClick={createAndAdd} disabled={creating}
              className="flex w-full items-center gap-2 rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] hover:bg-[var(--surface-hover)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: newColor }}/>
              {creating ? "Creating…" : `Create "${search.trim()}"`}
            </button>
          </div>
        )}

        {error && (
          <div className="px-3 pb-3">
            <p className="text-[11px] text-stone-400 bg-stone-400/10 rounded-lg px-2 py-1.5">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function TagBadges({ nodeId, onOpenPicker }: { nodeId: string; onOpenPicker?: () => void }) {
  const { data: tags, isLoading } = useQuery({
    queryKey: ["node-tags", nodeId],
    queryFn: () => apiClient.get<TagData[]>(`/tags/node/${nodeId}`),
  });
  if (isLoading) return null;
  return (
    <div className="flex flex-wrap gap-1 min-h-[20px]">
      {(tags ?? []).map(tag => (
        <span key={tag.id} onClick={onOpenPicker} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity"
          style={{ background: tag.color + "22", color: tag.color, border: `1px solid ${tag.color}33` }}>
          {tag.name}
        </span>
      ))}
      {(!tags || tags.length === 0) && onOpenPicker && (
        <button onClick={onOpenPicker} className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-secondary)] transition-colors">+ Add tag</button>
      )}
    </div>
  );
}
