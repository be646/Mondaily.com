import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Zap, Mail, GitBranch, Play, MoreHorizontal, Trash2, Copy, Loader2, X, Check, Sparkles } from "lucide-react";
import { AIMark } from "@/components/ui/ai-button";
import { LogoMark } from "@/components/logo";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { CommandPageHeader, MetricGrid } from "../../../components/ui/controls";
import { EmptyState } from "../../../components/ui/page-state";

// ─── AI Sequence Generator Modal ──────────────────────────────────────────────
function AISequenceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [stepCount, setStepCount] = useState(4);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; steps: any[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true); setError(""); setPreview(null);
    try {
      const res = await apiClient.post<{ name: string; steps: any[] }>("/generate/sequence", {
        prompt, steps: stepCount,
      });
      setPreview(res);
    } catch (e: any) { setError(e.message || "Failed to generate"); }
    finally { setLoading(false); }
  };

  const createSequence = async () => {
    if (!preview) return;
    setCreating(true);
    try {
      // API uses PATCH /sequences/new to create (id="new" triggers an INSERT)
      const seq = await apiClient.patch<{ id: string }>("/sequences/new", {
        name: preview.name,
        stop_on_reply: true,
        sending_days: ["Mon","Tue","Wed","Thu","Fri"],
        send_start: "09:00",
        send_end: "17:00",
        daily_limit: 50,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        unsubscribe: true,
        steps: preview.steps.map((s, i) => ({
          id: crypto.randomUUID(),
          type: s.type ?? "email",
          label: `Step ${i + 1}`,
          position: i,
          delay_value: s.delay_value ?? (i === 0 ? 0 : 3),
          delay_unit: s.delay_unit ?? "days",
          subject: s.subject ?? "",
          body: s.body ?? "",
          send_as: s.send_as ?? (i === 0 ? "new" : "reply"),
        })),
      });
      onCreated(seq.id);
    } catch (e: any) { setError(e.message || "Failed to create"); setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className={`w-full rounded-sm border border-[var(--border-soft)] bg-[var(--surface-card)] shadow-[0_24px_64px_rgba(0,0,0,0.7)] transition-all ${preview ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <LogoMark size={15} className="text-[var(--text-faint)]"/>
            <h2 className="font-semibold text-[var(--text-primary)]">Generate sequence with AI</h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16}/></button>
        </div>

        <div className="p-5 space-y-4">
          <textarea
            autoFocus
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            placeholder={`e.g. "Cold outreach to SaaS founders about our analytics tool" or "Follow-up sequence for leads who downloaded our whitepaper"`}
            className="w-full rounded-sm border border-[var(--border-soft)] bg-[var(--surface-hover)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-stone-600 resize-none outline-none focus:border-stone-500/40 transition-colors"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-muted)]">Steps</span>
            <div className="flex gap-1">
              {[3,4,5,6].map(n => (
                <button key={n} onClick={() => setStepCount(n)}
                  className={`w-9 rounded-md border py-1 text-xs font-medium transition-colors ${stepCount === n ? "border-stone-500/30 bg-stone-600/10 text-[var(--text-faint)]" : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-[var(--text-faint)]"}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-[var(--text-faint)]">{error}</p>}
        </div>

        {preview && (
          <div className="border-t border-[var(--border-soft)] px-5 pb-4">
            <p className="py-3 text-xs font-semibold text-[var(--text-faint)]">"{preview.name}" — {preview.steps.length} steps</p>
            <div className="space-y-2 max-h-64 overflow-auto">
              {preview.steps.map((s, i) => (
                <div key={i} className="rounded-lg border border-[var(--border-soft)] bg-[var(--surface-hover)] p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Step {i+1}</span>
                    {i > 0 && <span className="text-[10px] text-[var(--text-faint)]">· {s.delay_value}d delay</span>}
                  </div>
                  <p className="text-xs font-medium text-[var(--text-primary)]">{s.subject}</p>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)] line-clamp-2">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-5 border-t border-[var(--border-soft)]">
          <button onClick={onClose} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-faint)]">Cancel</button>
          {!preview ? (
            <button onClick={generate} disabled={loading || !prompt.trim()}
              className="flex items-center gap-2 rounded-lg border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)]">
              {loading ? <><Loader2 size={13} className="animate-spin"/> Generating…</> : <><LogoMark size={13}/> Generate</>}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={generate} disabled={loading} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-faint)]">Regenerate</button>
              <button onClick={createSequence} disabled={creating}
                className="flex items-center gap-2 rounded-lg border border-[var(--section-accent-line)] bg-[var(--section-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50 hover:bg-[color-mix(in_srgb,var(--section-accent)_22%,transparent)]">
                {creating ? <><Loader2 size={13} className="animate-spin"/> Creating…</> : <><Check size={13}/> Create sequence</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Automation {
  id: string;
  name: string;
  type: "workflow" | "sequence";
  status: string;
  updated_at: string;
  data?: { steps?: unknown[]; enrollments?: unknown[] };
}

function StatusBadge({ status }: { status: string }) {
  // Matte state chip (dot + label) — consistent with the rest of the app's tone system.
  const label: Record<string, string> = { active: "Active", draft: "Draft", paused: "Paused", archived: "Archived" };
  const color = status === "active" ? "#5f8169" : status === "paused" ? "#97824f" : "var(--text-faint)";
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} /> {label[status] ?? "Draft"}
    </span>
  );
}

export function AutomationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const seqQuery = useQuery({
    queryKey: ["automations", "sequences"],
    queryFn: async () => {
      const nodes = await apiClient.get<{ id: string; data: Record<string, unknown> }[]>("/nodes?object_type=automation&vertical=shared");
      return nodes.map(n => ({ id: n.id, ...n.data })) as Automation[];
    },
  });
  const items = seqQuery.data ?? [];
  const sequences = items.filter(i => (i as any).type === "sequence" || !(i as any).type);
  const workflows  = items.filter(i => (i as any).type === "workflow");

  const createSequence = useMutation({
    mutationFn: () => apiClient.patch<{ id: string }>("/sequences/new", {
      name: "New Sequence",
      stop_on_reply: true,
      sending_days: ["Mon","Tue","Wed","Thu","Fri"],
      send_start: "09:00",
      send_end: "17:00",
      daily_limit: 50,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      unsubscribe: true,
    }),
    onSuccess: (seq) => navigate(`/automations/sequences/${seq.id}`),
  });

  const createWorkflow = useMutation({
    mutationFn: () => apiClient.patch<{ id: string }>("/workflows/new", { name: "New Workflow", status: "draft", nodes: [] }),
    onSuccess: (wf) => navigate(`/automations/workflows/${wf.id}`),
  });

  const deleteItem = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "sequence"|"workflow" }) =>
      type === "workflow" ? apiClient.delete(`/workflows/${id}`) : apiClient.delete(`/sequences/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["automations", "sequences"] }); setMenuOpen(null); },
  });

  const duplicateItem = useMutation({
    mutationFn: async ({ item, type }: { item: Automation; type: "sequence"|"workflow" }) => {
      const name = `${item.name} (copy)`;
      if (type === "workflow") {
        return apiClient.patch<{ id: string }>("/workflows/new", { name, status: "draft", nodes: (item.data as any)?.nodes ?? [] });
      }
      return apiClient.patch<{ id: string }>("/sequences/new", {
        name,
        stop_on_reply: (item.data as any)?.stop_on_reply ?? true,
        sending_days: (item.data as any)?.sending_days ?? ["Mon","Tue","Wed","Thu","Fri"],
        send_start: (item.data as any)?.send_start ?? "09:00",
        send_end: (item.data as any)?.send_end ?? "17:00",
        daily_limit: (item.data as any)?.daily_limit ?? 50,
        timezone: (item.data as any)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        unsubscribe: (item.data as any)?.unsubscribe ?? true,
        steps: (item.data as any)?.steps ?? [],
      });
    },
    onSuccess: (res, { type }) => {
      qc.invalidateQueries({ queryKey: ["automations", "sequences"] });
      setMenuOpen(null);
      navigate(type === "workflow" ? `/automations/workflows/${res.id}` : `/automations/sequences/${res.id}`);
    },
  });

  function formatDate(s: string) {
    if (!s) return "—";
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const Section = ({ title, icon: Icon, items, newHref, newLabel, onNew }: {
    title: string; icon: any; items: Automation[]; newHref?: string; newLabel: string; onNew?: () => void;
  }) => (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-[var(--text-muted)]"/>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          <span className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{items.length}</span>
        </div>
        {onNew ? (
          <button
            onClick={onNew}
            disabled={createSequence.isPending}
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)] disabled:opacity-50" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
          >
            <Plus size={11}/> {newLabel}
          </button>
        ) : (
          <Link
            to={newHref!}
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
          >
            <Plus size={11}/> {newLabel}
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={`No ${title.toLowerCase()} yet`}
          description={title.toLowerCase().includes("sequence")
            ? "Multi-step email outreach that pauses when a lead replies. Draft one with AI, or start from scratch."
            : "Event-triggered automations — when a record changes, run actions. Build one to put your playbook on autopilot."}
          steps={[
            ...(onNew ? [{ icon: Plus, label: newLabel, hint: "Start from a blank builder and add your steps.", onClick: onNew }] : []),
            ...(title.toLowerCase().includes("sequence") ? [{ icon: Sparkles, label: "Generate with AI", hint: "Describe the goal — the agent drafts the steps for you to review.", onClick: () => setAiOpen(true) }] : []),
          ]}
        />
      ) : (
        <div className="overflow-hidden rounded-sm border border-[var(--border-soft)]">
          {items.map((item, i) => {
            const steps = (item.data as any)?.steps?.length ?? 0;
            const enrolled = (item.data as any)?.enrollments?.length ?? 0;
            const href = title.toLowerCase().includes("sequence")
              ? `/automations/sequences/${item.id}`
              : `/automations/workflows/${item.id}`;
            return (
              <div
                key={item.id}
                className={`group relative flex items-center gap-4 px-4 py-3.5 hover:bg-[var(--surface-hover)] transition-colors ${i < items.length - 1 ? "border-b border-[var(--border-soft)]" : ""}`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
                  <Icon size={14}/>
                </div>

                <Link to={href} className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{item.name}</p>
                  <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                    {steps > 0 ? `${steps} step${steps !== 1 ? "s" : ""}` : "No steps"}
                    {enrolled > 0 ? ` · ${enrolled} enrolled` : ""}
                    {item.updated_at ? ` · Updated ${formatDate(item.updated_at)}` : ""}
                  </p>
                </Link>

                <StatusBadge status={(item.data as any)?.status ?? item.status ?? "draft"}/>

                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === item.id ? null : item.id); }}
                    className="rounded-md p-1.5 text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-hover)] hover:text-[var(--text-faint)] transition-all"
                  >
                    <MoreHorizontal size={14}/>
                  </button>
                  {menuOpen === item.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)}/>
                      <div className="dropdown-panel absolute right-0 top-8 z-20 w-36">
                        <Link to={href} className="dropdown-item flex items-center gap-2">
                          <Play size={11}/> Open
                        </Link>
                        <button
                          onClick={() => duplicateItem.mutate({ item, type: title.toLowerCase().includes("sequence") ? "sequence" : "workflow" })}
                          disabled={duplicateItem.isPending}
                          className="dropdown-item flex w-full items-center gap-2 disabled:opacity-50">
                          <Copy size={11}/> Duplicate
                        </button>
                        <button
                          onClick={() => deleteItem.mutate({ id: item.id, type: title.toLowerCase().includes("sequence") ? "sequence" : "workflow" })}
                          disabled={deleteItem.isPending}
                          className="dropdown-item flex w-full items-center gap-2 text-[var(--text-faint)] hover:text-[var(--text-faint)] disabled:opacity-50">
                          <Trash2 size={11}/> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Real at-a-glance counts from the loaded items (never fabricated).
  const activeCount = items.filter(i => ((i.data as any)?.status ?? (i as any).status) === "active").length;
  const enrolledTotal = items.reduce((s, i) => s + (((i.data as any)?.enrollments?.length as number) ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Shared command header — same pattern as Decisions / Reports / Team / Home. */}
      <CommandPageHeader
        icon={Zap}
        callsign="AUTOMATIONS"
        title="Automations"
        subtitle="Sequences and workflows that run your playbook automatically."
        status={[{ label: activeCount > 0 ? `${activeCount} active` : "none active", kind: activeCount > 0 ? "running" : "monitoring" }]}
        secondaryActions={
          <button onClick={() => setAiOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            <AIMark size={12}/> Generate with AI
          </button>
        }
        primaryAction={
          <button onClick={() => createSequence.mutate()} disabled={createSequence.isPending}
            className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
            {createSequence.isPending ? <Loader2 size={13} className="animate-spin"/> : <Plus size={13}/>} New sequence
          </button>
        }
      />

      {items.length > 0 && (
        <MetricGrid className="mb-6" cols={4} items={[
          { label: "Active", value: activeCount, tone: activeCount > 0 ? "#5f8169" : undefined },
          { label: "Sequences", value: sequences.length },
          { label: "Workflows", value: workflows.length },
          { label: "Enrolled", value: enrolledTotal },
        ]} />
      )}

      {seqQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--section-accent)" }} />
        </div>
      ) : (
        <div>
          <Section
            title="Email Sequences"
            icon={Mail}
            items={items.filter(i => (i.data as any)?.type === "sequence" || !(i.data as any)?.type)}
            newLabel="New sequence"
            onNew={() => createSequence.mutate()}
          />
          <Section
            title="Workflows"
            icon={GitBranch}
            items={workflows}
            newLabel="New workflow"
            onNew={() => createWorkflow.mutate()}
          />
        </div>
      )}
      {aiOpen && (
        <AISequenceModal
          onClose={() => setAiOpen(false)}
          onCreated={(id) => { setAiOpen(false); navigate(`/automations/sequences/${id}`); }}
        />
      )}
    </div>
  );
}
