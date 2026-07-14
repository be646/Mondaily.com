import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles, ChevronDown, ArrowUpRight, MessageSquare, GitBranch, Wand2, ListPlus, History } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { requestAsk } from "../../lib/ask-bus";

/**
 * AI Inspector — a reusable, context-aware panel for records / tasks / lists / reports / finance.
 * It shows ONLY real information: the object's own fields, its real activity log, its real graph
 * neighbours, and signals DERIVED from those (missing/stale fields, last agent action). Confidence
 * is qualitative only — never a fabricated numeric score. AI actions route through the existing Ask
 * engine via the ask-bus (no new AI endpoint). Collapsible; premium-minimal flat rows.
 */

export type InspectorKind = "record" | "task" | "list" | "report" | "invoice";

export interface InspectorContext {
  kind: InspectorKind;
  id: string;
  title: string;
  objectType?: string;         // e.g. "company", "deal", "invoice"
  data?: Record<string, unknown>; // the object's own fields (for missing/stale detection + finance signals)
  updatedAt?: string | null;
  /** Only for kind==="record": enables graph-neighbour + activity fetch from /nodes/:id. */
  nodeId?: string;
  /** Human scope label for the Ask context, e.g. `the deal "Acme renewal"`. */
  scopeLabel?: string;
}

interface Activity { id: string; action: string; actor_type?: string; actor_id?: string; created_at: string; diff?: Record<string, unknown> | null }
interface RelatedNode { id: string; object_type: string; data: Record<string, unknown> }

type Confidence = "source-backed" | "ready" | "needs review" | "missing evidence" | "stale";
const CONF_TONE: Record<Confidence, string> = {
  "source-backed": "#2f9e6b", ready: "#2f9e6b", "needs review": "#c6892e", "missing evidence": "#c6892e", stale: "#c6892e",
};

const relAgo = (iso?: string | null): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const nameOf = (n: RelatedNode) => String(n.data?.name ?? n.data?.title ?? n.data?.subject ?? n.data?.email ?? "Untitled");
const humanField = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Which fields we'd expect on a useful record of each type — used ONLY to flag genuinely-empty
// ones (real "missing evidence"), never to invent values.
const EXPECTED: Record<string, string[]> = {
  company: ["name", "website", "industry", "email"],
  companies: ["name", "website", "industry", "email"],
  person: ["name", "email"],
  people: ["name", "email"],
  contact: ["name", "email"],
  deal: ["name", "amount", "stage"],
  deals: ["name", "amount", "stage"],
  invoice: ["client", "total", "status", "due_date"],
};

export function AIInspector({ ctx, activities: passedActivities, defaultOpen = true }: {
  ctx: InspectorContext;
  activities?: Activity[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showRelated, setShowRelated] = useState(false);

  // Graph neighbours — real edges only, fetched for record-kind objects.
  const relatedQ = useQuery({
    queryKey: ["inspector-related", ctx.nodeId],
    queryFn: () => apiClient.get<RelatedNode[]>(`/nodes/${ctx.nodeId}/related`),
    enabled: open && ctx.kind === "record" && !!ctx.nodeId,
    staleTime: 60_000,
  });
  // Activity — use what the page already loaded; otherwise fetch the node (which returns activities).
  const nodeQ = useQuery({
    queryKey: ["inspector-node", ctx.nodeId],
    queryFn: () => apiClient.get<{ activities?: Activity[]; ai_summary?: string }>(`/nodes/${ctx.nodeId}`),
    enabled: open && ctx.kind === "record" && !!ctx.nodeId && !passedActivities,
    staleTime: 60_000,
  });
  const activities: Activity[] = passedActivities ?? nodeQ.data?.activities ?? [];
  const related = relatedQ.data ?? [];

  // ── Derive real signals (no fabrication) ──
  const data = ctx.data ?? {};
  const expected = ctx.objectType ? (EXPECTED[ctx.objectType.toLowerCase()] ?? []) : [];
  const missing = expected.filter((f) => {
    const v = data[f];
    return v == null || v === "" || (typeof v === "string" && !v.trim());
  });
  const ageDays = ctx.updatedAt ? Math.floor((Date.now() - new Date(ctx.updatedAt).getTime()) / 86_400_000) : null;
  const isStale = ageDays != null && ageDays > 30;
  const lastAgent = activities.find((a) => a.actor_type === "agent" || a.actor_type === "system" || a.actor_type === "ai");
  const recentChanges = activities.slice(0, 3);

  // Qualitative confidence — from real signals only.
  const confidence: Confidence =
    missing.length > 0 ? "missing evidence"
    : isStale ? "stale"
    : (related.length > 0 || lastAgent) ? "source-backed"
    : activities.length > 0 ? "ready"
    : "needs review";

  // Finance signals — real fields on the object, shown only when present.
  const financeSignals: { label: string; value: string }[] = [];
  const money = (v: unknown) => (typeof v === "number" ? v.toLocaleString(undefined, { style: "currency", currency: "USD" }) : String(v));
  if (data.total != null) financeSignals.push({ label: "Total", value: money(data.total) });
  if (data.amount != null) financeSignals.push({ label: "Amount", value: money(data.amount) });
  if (data.status != null && (ctx.kind === "invoice" || ctx.objectType?.includes("invoice") || ctx.objectType?.includes("deal"))) financeSignals.push({ label: "Status", value: String(data.status) });
  if (data.due_date != null) financeSignals.push({ label: "Due", value: String(data.due_date) });

  // Suggested next actions — deterministic, derived from the real gaps above (labelled "suggested",
  // not presented as AI-certain). Each routes to the real Ask engine or a real toggle.
  const scope = ctx.scopeLabel ?? `${ctx.objectType ? ctx.objectType + " " : ""}"${ctx.title}"`;
  const suggestions: { label: string; prompt: string }[] = [];
  if (missing.length) suggestions.push({ label: `Fill missing: ${missing.map(humanField).join(", ")}`, prompt: `${scope} is missing ${missing.join(", ")}. Find these from the workspace graph or the web and tell me what you can confirm, with sources.` });
  if (isStale) suggestions.push({ label: `Refresh — last updated ${ageDays}d ago`, prompt: `${scope} hasn't been updated in ${ageDays} days. Summarise what may have changed and what I should check, based on real records and activity.` });
  if (related.length === 0 && ctx.kind === "record") suggestions.push({ label: "Link related records", prompt: `${scope} has no linked records. Suggest which existing workspace records it should be connected to, with reasons.` });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-sm border px-3 py-2 text-left transition-colors hover:border-[color:var(--section-accent)]"
        style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <Sparkles size={13} style={{ color: "var(--section-accent)" }} />
        <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>AI Inspector</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px]" style={{ color: CONF_TONE[confidence] }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: CONF_TONE[confidence] }} /> {confidence}
        </span>
        <ChevronDown size={13} style={{ color: "var(--text-faint)" }} />
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-sm border" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
      {/* Header + qualitative confidence strip */}
      <button onClick={() => setOpen(false)} className="flex w-full items-center gap-2 border-b px-3.5 py-2.5 text-left" style={{ borderColor: "var(--border-soft)" }}>
        <Sparkles size={13} style={{ color: "var(--section-accent)" }} />
        <span className="text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>AI Inspector</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: CONF_TONE[confidence], background: `color-mix(in srgb, ${CONF_TONE[confidence]} 12%, transparent)` }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: CONF_TONE[confidence] }} /> {confidence}
        </span>
        <ChevronDown size={13} className="rotate-180" style={{ color: "var(--text-faint)" }} />
      </button>

      <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
        {/* Summary */}
        <Row label="Summary">
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {(nodeQ.data?.ai_summary as string) || (typeof data.ai_summary === "string" && data.ai_summary) ||
              `${ctx.objectType ? humanField(ctx.objectType) : "Object"} · ${ctx.title}${ageDays != null ? ` · updated ${relAgo(ctx.updatedAt)}` : ""}${related.length ? ` · ${related.length} linked` : ""}.`}
          </p>
        </Row>

        {/* Missing / stale fields — real gaps only */}
        {(missing.length > 0 || isStale) && (
          <Row label="Attention">
            <div className="flex flex-wrap gap-1.5">
              {missing.map((f) => (
                <span key={f} className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ color: "#c6892e", background: "color-mix(in srgb, #c6892e 12%, transparent)" }}>Missing: {humanField(f)}</span>
              ))}
              {isStale && <span className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ color: "#c6892e", background: "color-mix(in srgb, #c6892e 12%, transparent)" }}>Stale · {ageDays}d</span>}
            </div>
          </Row>
        )}

        {/* Recent changes — real activity log */}
        {recentChanges.length > 0 && (
          <Row label="Recent changes">
            <ul className="space-y-1">
              {recentChanges.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                  <History size={11} className="shrink-0" style={{ color: "var(--text-faint)" }} />
                  <span className="capitalize">{a.action}</span>
                  <span className="ml-auto shrink-0 text-[10.5px]" style={{ color: "var(--text-faint)" }}>{relAgo(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}

        {/* Finance signals — real fields only */}
        {financeSignals.length > 0 && (
          <Row label="Finance">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {financeSignals.map((s) => (
                <span key={s.label} className="text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--text-faint)" }}>{s.label}: </span>{s.value}
                </span>
              ))}
            </div>
          </Row>
        )}

        {/* Related records — real graph neighbours */}
        {ctx.kind === "record" && ctx.nodeId && (
          <Row label="Graph context">
            {relatedQ.isLoading ? (
              <span className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>Loading related records…</span>
            ) : related.length === 0 ? (
              <span className="text-[11.5px]" style={{ color: "var(--text-faint)" }}>No linked records yet.</span>
            ) : (
              <>
                <button onClick={() => setShowRelated((s) => !s)} className="inline-flex items-center gap-1 text-[11.5px] font-medium" style={{ color: "var(--section-accent)" }}>
                  {related.length} linked record{related.length === 1 ? "" : "s"} <ChevronDown size={11} className={showRelated ? "rotate-180" : ""} />
                </button>
                {showRelated && (
                  <div className="mt-1.5 space-y-1">
                    {related.slice(0, 8).map((r) => (
                      <Link key={r.id} to={`/objects/${r.object_type}/${r.id}`} className="flex items-center gap-2 text-[11.5px] transition-colors hover:text-[var(--section-accent)]" style={{ color: "var(--text-secondary)" }}>
                        <GitBranch size={11} className="shrink-0" style={{ color: "var(--text-faint)" }} />
                        <span className="truncate">{nameOf(r)}</span>
                        <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>{r.object_type}</span>
                        <ArrowUpRight size={10} className="shrink-0" style={{ color: "var(--text-faint)" }} />
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </Row>
        )}

        {/* Last agent activity — real, only if an agent/system actor touched it */}
        {lastAgent && (
          <Row label="Last agent action">
            <p className="text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
              <span className="capitalize">{lastAgent.action}</span>
              <span className="ml-1.5" style={{ color: "var(--text-faint)" }}>· {relAgo(lastAgent.created_at)}</span>
            </p>
          </Row>
        )}

        {/* Suggested next actions — derived from real gaps, routed through the real Ask engine */}
        {suggestions.length > 0 && (
          <Row label="Suggested next">
            <div className="space-y-1">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => requestAsk(s.prompt)}
                  className="flex w-full items-center gap-1.5 text-left text-[11.5px] transition-colors hover:text-[var(--section-accent)]" style={{ color: "var(--text-secondary)" }}>
                  <Wand2 size={11} className="shrink-0" style={{ color: "var(--section-accent)" }} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </Row>
        )}

        {/* Actions — every AI action reuses the existing Ask drawer/engine (ask-bus) */}
        <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
          <Action icon={MessageSquare} label="Ask about this" onClick={() => requestAsk(`Tell me what I need to know about ${scope}, based only on real records, activity, and sources.`)} />
          <Action icon={History} label="Explain recent changes" onClick={() => requestAsk(`Explain what changed recently on ${scope}, using its real activity log.`)} />
          <Action icon={Wand2} label="Draft next action" onClick={() => requestAsk(`Based on the real state of ${scope}, draft the single best next action and prepare it for my approval.`)} />
          <Action icon={ListPlus} label="Create task" onClick={() => requestAsk(`Create a task to follow up on ${scope}. If the title or due date is ambiguous, ask me to confirm before creating it.`)} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-2.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{label}</p>
      {children}
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
