import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { X, GitBranch, History, CheckSquare, StickyNote, Receipt, Bot, MessageSquare, Wand2, ArrowUpRight, Network } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestAsk } from "../../lib/ask-bus";
import type { InspectorContext } from "../ai/ai-inspector";

/**
 * Graph Context Drawer — a reusable right-side panel showing the REAL connected context around the
 * current object: its graph neighbours, recent activity, connected work (tasks / notes / finance),
 * and last agent action. Real data only, via existing endpoints (/nodes/:id/related,
 * /nodes?object_type=…, /invoices|/credit-notes?linked_record_id=…). Anything with no data source
 * shows an honest "Not connected yet" — never fabricated. Ask actions reuse the existing Ask engine
 * via the ask-bus. Distinct from the AI Inspector: this is connected context, not interpretation.
 */

interface Activity { id: string; action: string; actor_type?: string; created_at: string }
interface Node { id: string; object_type: string; data: Record<string, unknown> }
interface FinanceRow { id: string; number?: string; total?: number; status?: string; amount?: number }

const nameOf = (n: Node) => String(n.data?.name ?? n.data?.title ?? n.data?.subject ?? n.data?.email ?? "Untitled");
const humanType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const relAgo = (iso?: string | null): string => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

/** Drop-in "Graph" button that owns the drawer state — so pages add one line, no per-page state. */
export function GraphContextButton({ ctx, activities }: { ctx: InspectorContext; activities?: Activity[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
        style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
        title="Show connected graph context"
      >
        <Network size={12} style={{ color: "var(--section-accent)" }} /> Graph
      </button>
      {open && <GraphContextDrawer ctx={ctx} activities={activities} onClose={() => setOpen(false)} />}
    </>
  );
}

export function GraphContextDrawer({ ctx, activities: passedActivities, onClose }: {
  ctx: InspectorContext; activities?: Activity[]; onClose: () => void;
}) {
  const nodeId = ctx.kind === "record" ? ctx.nodeId : undefined;

  // Graph neighbours (real edges).
  const relatedQ = useQuery({
    queryKey: ["graph-related", nodeId],
    queryFn: () => apiClient.get<Node[]>(`/nodes/${nodeId}/related`),
    enabled: !!nodeId, staleTime: 60_000,
  });
  // Activity — reuse what the page passed, else fetch the node (which returns activities).
  const nodeQ = useQuery({
    queryKey: ["graph-node", nodeId],
    queryFn: () => apiClient.get<{ activities?: Activity[] }>(`/nodes/${nodeId}`),
    enabled: !!nodeId && !passedActivities, staleTime: 60_000,
  });
  // Connected work — tasks + notes linked to this record (existing filter pattern), finance links.
  const tasksQ = useQuery({
    queryKey: ["graph-tasks", nodeId],
    queryFn: async () => (await apiClient.get<Node[]>("/nodes?object_type=task&limit=200")).filter((t) => t.data?.parent_id === nodeId),
    enabled: !!nodeId, staleTime: 60_000,
  });
  const notesQ = useQuery({
    queryKey: ["graph-notes", nodeId],
    queryFn: async () => (await apiClient.get<Node[]>("/nodes?object_type=note&limit=200")).filter((n) => n.data?.parent_id === nodeId),
    enabled: !!nodeId, staleTime: 60_000,
  });
  const invoicesQ = useQuery({
    queryKey: ["graph-invoices", nodeId],
    queryFn: () => apiClient.get<FinanceRow[]>(`/invoices?linked_record_id=${nodeId}`),
    enabled: !!nodeId, staleTime: 60_000,
  });
  const creditNotesQ = useQuery({
    queryKey: ["graph-creditnotes", nodeId],
    queryFn: () => apiClient.get<FinanceRow[]>(`/credit-notes?linked_record_id=${nodeId}`),
    enabled: !!nodeId, staleTime: 60_000,
  });

  const activities = passedActivities ?? nodeQ.data?.activities ?? [];
  const related = relatedQ.data ?? [];
  const tasks = tasksQ.data ?? [];
  const notes = notesQ.data ?? [];
  const invoices = invoicesQ.data ?? [];
  const creditNotes = creditNotesQ.data ?? [];
  const lastAgent = activities.find((a) => a.actor_type === "agent" || a.actor_type === "system" || a.actor_type === "ai");

  // Group graph neighbours by object type.
  const grouped = related.reduce<Record<string, Node[]>>((acc, n) => {
    (acc[n.object_type] ??= []).push(n); return acc;
  }, {});
  const isNodeBacked = !!nodeId;
  const sourceBacked = related.length > 0 || activities.length > 0;
  const scope = ctx.scopeLabel ?? `${ctx.objectType ? ctx.objectType + " " : ""}"${ctx.title}"`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Graph context">
      <div className="flex-1 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="flex h-full w-full max-w-md flex-col border-l" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        {/* 1. Header */}
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3.5" style={{ borderColor: "var(--border-soft)" }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch size={14} style={{ color: "var(--section-accent)" }} />
              <span className="truncate text-[13.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{ctx.title}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
              <span>{ctx.objectType ? humanType(ctx.objectType) : humanType(ctx.kind)}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1" style={{ color: sourceBacked ? "#2f9e6b" : "var(--text-faint)" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: sourceBacked ? "#2f9e6b" : "var(--text-faint)" }} />
                {sourceBacked ? "source-backed" : "no linked context"}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 hover:text-[var(--text-primary)]" style={{ color: "var(--text-muted)" }} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 2. Relationship map */}
          <Section title="Relationships" count={related.length}>
            {!isNodeBacked ? (
              <Empty>This {humanType(ctx.kind).toLowerCase()} isn't a graph node, so it has no relationship edges.</Empty>
            ) : relatedQ.isLoading ? (
              <Loading />
            ) : related.length === 0 ? (
              <Empty>No linked records yet.</Empty>
            ) : (
              <div className="space-y-3">
                {Object.entries(grouped).map(([type, nodes]) => (
                  <div key={type}>
                    <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                      {humanType(type)} <span className="tabular-nums">· {nodes.length}</span>
                    </div>
                    <div className="space-y-0.5">
                      {nodes.slice(0, 10).map((n) => (
                        <Link key={n.id} to={`/objects/${n.object_type}/${n.id}`} onClick={onClose}
                          className="group flex items-center gap-2 rounded-sm px-1.5 py-1 text-[12px] transition-colors hover:bg-[var(--surface-hover)]" style={{ color: "var(--text-secondary)" }}>
                          <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--section-accent)" }} />
                          <span className="min-w-0 flex-1 truncate">{nameOf(n)}</span>
                          <ArrowUpRight size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--text-faint)" }} />
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 3. Activity timeline */}
          <Section title="Activity" count={activities.length}>
            {activities.length === 0 ? (
              <Empty>{isNodeBacked ? "No recorded activity yet." : "No activity available for this view."}</Empty>
            ) : (
              <ul className="space-y-1.5">
                {activities.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                    <History size={11} className="shrink-0" style={{ color: "var(--text-faint)" }} />
                    <span className="capitalize">{a.action}</span>
                    {a.actor_type && <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>· {a.actor_type}</span>}
                    <span className="ml-auto shrink-0 text-[10.5px]" style={{ color: "var(--text-faint)" }}>{relAgo(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* 4. Connected work */}
          <Section title="Connected work">
            {!isNodeBacked ? (
              <Empty>Not connected yet — this view has no linked tasks, notes, or finance.</Empty>
            ) : (
              <div className="space-y-2.5">
                <WorkGroup icon={CheckSquare} label="Tasks" items={tasks.map((t) => ({ id: t.id, label: String(t.data?.title ?? t.data?.name ?? "Task"), to: undefined }))} loading={tasksQ.isLoading} />
                <WorkGroup icon={StickyNote} label="Notes" items={notes.map((n) => ({ id: n.id, label: String(n.data?.title ?? n.data?.content ?? "Note").slice(0, 60), to: undefined }))} loading={notesQ.isLoading} />
                <WorkGroup icon={Receipt} label="Finance" loading={invoicesQ.isLoading || creditNotesQ.isLoading}
                  items={[
                    ...invoices.map((i) => ({ id: i.id, label: `Invoice ${i.number ?? ""} · ${i.status ?? ""}`.trim(), to: `/finance/invoices/${i.id}` })),
                    ...creditNotes.map((c) => ({ id: c.id, label: `Credit note ${c.number ?? ""}`.trim(), to: `/finance/credit-notes/${c.id}` })),
                  ]}
                  onNav={onClose} />
                {/* Decisions: no per-object GET filter exists — honest note rather than a fake list. */}
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
                  <Bot size={11} /> Decisions — review in the <Link to="/decisions" onClick={onClose} className="font-medium hover:underline" style={{ color: "var(--section-accent)" }}>Decision Deck</Link>.
                </div>
              </div>
            )}
          </Section>

          {/* 5. Agent context */}
          <Section title="Agent context">
            {lastAgent ? (
              <p className="text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                Last agent action: <span className="capitalize">{lastAgent.action}</span> <span style={{ color: "var(--text-faint)" }}>· {relAgo(lastAgent.created_at)}</span>
              </p>
            ) : (
              <Empty>No agent has acted on this yet.</Empty>
            )}
            <Link to="/activity" onClick={onClose} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>
              Open Agent Control Room <ArrowUpRight size={11} />
            </Link>
          </Section>
        </div>

        {/* 6. Ask AI actions */}
        <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--border-soft)" }}>
          <div className="flex flex-wrap gap-1.5">
            <Action icon={MessageSquare} label="Ask about this graph" onClick={() => { requestAsk(`Explain the connected graph around ${scope} — the linked records, activity, and connected work — using only real data.`); onClose(); }} />
            <Action icon={GitBranch} label="Explain relationships" onClick={() => { requestAsk(`Explain how ${scope} is related to its linked records and why those connections matter, based on the real graph.`); onClose(); }} />
            <Action icon={History} label="What changed here?" onClick={() => { requestAsk(`What changed recently across ${scope} and its connected records? Use the real activity log.`); onClose(); }} />
            <Action icon={Wand2} label="Draft next action" onClick={() => { requestAsk(`Given the real connected context of ${scope}, draft the single best next action and prepare it for my approval.`); onClose(); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-soft)" }}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{title}</span>
        {count != null && count > 0 && <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>{children}</p>;
}
function Loading() {
  return <p className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>Loading…</p>;
}
function WorkGroup({ icon: Icon, label, items, loading, onNav }: {
  icon: React.ElementType; label: string; items: { id: string; label: string; to?: string }[]; loading?: boolean; onNav?: () => void;
}) {
  return (
    <div>
      <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        <Icon size={11} /> {label} {items.length > 0 && <span className="tabular-nums">· {items.length}</span>}
      </div>
      {loading ? (
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Not connected yet.</p>
      ) : (
        <div className="space-y-0.5">
          {items.slice(0, 6).map((it) => it.to ? (
            <Link key={it.id} to={it.to} onClick={onNav} className="block truncate text-[11.5px] transition-colors hover:text-[var(--section-accent)]" style={{ color: "var(--text-secondary)" }}>{it.label}</Link>
          ) : (
            <p key={it.id} className="truncate text-[11.5px]" style={{ color: "var(--text-secondary)" }}>{it.label}</p>
          ))}
        </div>
      )}
    </div>
  );
}
function Action({ icon: Icon, label, onClick }: { icon: React.ElementType; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-[color:var(--section-accent)]"
      style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
      <Icon size={11} style={{ color: "var(--section-accent)" }} /> {label}
    </button>
  );
}
