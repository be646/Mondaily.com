import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Lock, ArrowLeft, ShieldCheck, Loader2, User as UserIcon } from "lucide-react";
import { apiClient } from "../../lib/api-client";
import { agentByRaw } from "../../lib/agents";
import { PageHeader } from "../../components/ui/page-state";

interface OversightRow {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  action: string;
  ai_summary: string | null;
  object: { type: string; name: string | null } | null;
  created_at: string;
}
interface ActorTally { actor_id?: string | null; actor_type?: string | null; actor_name?: string | null; actor_avatar?: string | null; count?: number }

// Resolve any actor (human / agent / system) → a consistent display identity.
// Defensive: a missing/stale actor never throws — it falls back to a clear label.
function actorIdentity(r: { actor_type?: string | null; actor_id?: string | null; actor_name?: string | null } | null | undefined) {
  const type = r?.actor_type;
  if (type === "agent") { const a = agentByRaw(r?.actor_id ?? ""); return { name: a?.name ?? "Autonomous System Agent", isAgent: true }; }
  if (type === "system") return { name: "Autonomous System Agent", isAgent: false };
  return { name: r?.actor_name || "Unknown Member", isAgent: false };
}
function dayLabel(iso?: string | null) {
  if (!iso) return "Earlier";
  const d = new Date(iso); if (isNaN(d.getTime())) return "Earlier";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
function clock(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function TeamOversightPage() {
  const navigate = useNavigate();
  const [actorFilter, setActorFilter] = useState<string | null>(null);

  // RBAC is enforced SERVER-SIDE: /activities/oversight is wrapped in requireAdminRole and
  // 403s non-admins. We gate the UI off that real result (the /settings/members payload
  // can't be used — it returns empty emails — so client email-matching is unreliable).
  const { data, isLoading, isError, error } = useQuery<{ activity: OversightRow[]; actors: ActorTally[] }>({
    queryKey: ["team-oversight"],
    queryFn: () => apiClient.get<{ activity: OversightRow[]; actors: ActorTally[] }>("/activities/oversight?limit=200"),
    refetchInterval: 30_000,
    retry: false,
  });
  const forbidden = isError && /\b403\b|forbidden/i.test(String((error as Error | null)?.message ?? ""));

  // Access-denied — standard members (server returned 403).
  if (forbidden) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
          <Lock size={20} style={{ color: "var(--accent)" }} />
        </span>
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>Manager access only</h1>
        <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Team Oversight shows what every member has done across the workspace. Only <strong>Owners</strong> and <strong>Admins</strong> can view it. Ask a workspace admin for access.
        </p>
        <button onClick={() => navigate("/home")} className="mt-5 inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-colors" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}>
          <ArrowLeft size={14} /> Back to home
        </button>
      </div>
    );
  }

  // Defensive: payload may be empty/loading/malformed — never let it crash the page.
  const rows = (Array.isArray(data?.activity) ? data!.activity : []).filter(r => r && (!actorFilter || String(r?.actor_id) === actorFilter));
  const actors = Array.isArray(data?.actors) ? data!.actors : [];

  // Group chronologically by day.
  const groups: { day: string; items: OversightRow[] }[] = [];
  for (const r of rows) {
    const day = dayLabel(r?.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(r); else groups.push({ day, items: [r] });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader title="Team Oversight" description="Who did what across the workspace — every member and agent action, newest first." />

      {/* Actor roll-up — click to filter the timeline */}
      {actors.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {actors.map((a, ai) => {
            const id = actorIdentity(a);
            const on = actorFilter === a?.actor_id;
            return (
              <button key={a?.actor_id || a?.actor_type || ai} onClick={() => setActorFilter(on ? null : (a?.actor_id ?? null))}
                className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[12px] transition-all hover:-translate-y-px"
                style={on ? { borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" } : { borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
                <Avatar avatar={a?.actor_avatar ?? null} isAgent={id.isAgent} name={id.name} actorId={a?.actor_id ?? null} />
                <span style={{ color: "var(--text-secondary)" }}>{id.name}</span>
                <span className="tabular-nums" style={{ color: "var(--text-faint)" }}>{a?.count ?? 0}</span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm" style={{ color: "var(--text-muted)" }}><Loader2 size={15} className="animate-spin" /> Loading activity…</div>
      ) : rows.length === 0 ? (
        <div className="surface-card rounded-2xl px-5 py-10 text-center">
          <ShieldCheck size={20} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>No activity yet</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>Member and agent actions will appear here as they happen.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(g => (
            <div key={g.day}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>{g.day}</div>
              <div className="surface-card overflow-hidden rounded-2xl">
                {g.items.map((r, i) => {
                  const id = actorIdentity(r);
                  return (
                    <div key={r?.id ?? `${g.day}-${i}`} className="flex items-start gap-3 px-4 py-3" style={i > 0 ? { borderTop: "1px solid var(--border-soft)" } : undefined}>
                      <Avatar avatar={r?.actor_avatar ?? null} isAgent={id.isAgent} name={id.name} actorId={r?.actor_id ?? null} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{id.name}</span>
                          <span className="text-[12.5px]" style={{ color: "var(--text-secondary)" }}>{r?.action?.replace(/_/g, " ") || "did something"}</span>
                          {r?.object?.name && <span className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>· {r.object.name}</span>}
                        </div>
                        {r?.ai_summary && <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--text-muted)" }}>{r.ai_summary}</p>}
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>{clock(r?.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ avatar, isAgent, name, actorId }: { avatar: string | null; isAgent: boolean; name: string; actorId: string | null }) {
  if (avatar) return <img src={avatar} alt={name} className="h-7 w-7 shrink-0 rounded-full object-cover" />;
  if (isAgent) {
    const A = agentByRaw(actorId ?? "");
    return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}><A.Icon size={14} style={{ color: "var(--accent)" }} /></span>;
  }
  const initial = name?.trim()?.[0]?.toUpperCase();
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
      {initial || <UserIcon size={13} />}
    </span>
  );
}
