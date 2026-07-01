import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { Check, Copy, Trash2, UserPlus, Cpu, Clock, SlidersHorizontal } from "lucide-react";
import { Fragment, useState } from "react";
import { apiClient } from "../../../lib/api-client";

/**
 * Team Operators — the single home for everyone in the workspace: role, finance access, AI compute
 * consumption, and last-active, plus invites + pending invitations. Atomic and fully guarded — every
 * field is read with optional chaining + fallback and the row iterator is explicitly length-checked,
 * so a malformed/blank member row can never throw (the old pitch-black crash).
 */
interface Member {
  id?: string; name?: string | null; email?: string | null; image_url?: string | null;
  role?: string | null; finance_role?: string | null; tokens?: number | null; last_active?: string | null;
  module_access?: Record<string, string> | null;
}
interface Invitation { id?: string; email?: string | null; role?: string | null }
interface ModuleDef { key: string; label: string; hint?: string }
interface MembersData { members?: Member[]; invitations?: Invitation[]; modules?: ModuleDef[]; can_invite?: boolean }

const roleLabel = (r?: string | null) => r === "owner" ? "Owner" : r === "admin" ? "Admin" : r === "viewer" ? "Viewer" : "Member";
const ROLE_OPTIONS = ["admin", "member", "viewer"] as const;
const LEVELS: [string, string][] = [["none", "None"], ["view", "View"], ["edit", "Edit"]];
const LEVEL_COLOR: Record<string, string> = { none: "#52525b", view: "#a1a1aa", edit: "var(--section-accent)" };

const fmt = (n: number) => n.toLocaleString();
function ago(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(d.getTime())) return "—";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function MembersSettings() {
  const qc = useQueryClient();
  const me = useCurrentUser();
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [emails, setEmails] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [inviteResults, setInviteResults] = useState<{ email: string; link: string | null; sent: boolean; error: string | null }[]>([]);

  const query = useQuery({ queryKey: ["members"], queryFn: () => apiClient.get<MembersData>("/settings/members"), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["members"] });

  const members: Member[] = Array.isArray(query.data?.members) ? query.data!.members! : [];
  const invitations: Invitation[] = Array.isArray(query.data?.invitations) ? query.data!.invitations! : [];
  const modules: ModuleDef[] = Array.isArray(query.data?.modules) && query.data!.modules!.length
    ? query.data!.modules!
    : [{ key: "graph", label: "Graph" }, { key: "discovery", label: "Discovery" }, { key: "automations", label: "Automations" }, { key: "communications", label: "Communications" }, { key: "reports", label: "Reports" }];
  // Trust the backend's authoritative my_role first; fall back to client-side matching only if
  // it's absent. This is what finally makes the invite bar appear for owners reliably.
  const matchedRole = members.find(m =>
    (me.userId && m?.id === me.userId) ||
    (!!m?.email && m.email.toLowerCase() === me.email?.toLowerCase()),
  )?.role;
  const myRole = (query.data as { my_role?: string } | undefined)?.my_role ?? matchedRole ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";
  // Invites only on multi-operator tiers (Command/Sovereign). Single-operator plans can't add members.
  const canInvite = query.data?.can_invite ?? false;

  const changeRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => apiClient.patch(`/settings/members/${id}`, { role }), onSuccess: refresh });
  const changeModule = useMutation({ mutationFn: ({ id, module, level }: { id: string; module: string; level: string }) => apiClient.patch(`/settings/members/${id}`, { module, level }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => apiClient.delete(`/settings/members/${id}`), onSuccess: refresh });
  const sendInvite = useMutation({
    mutationFn: async () => {
      const list = emails.split(/[\s,]+/).filter(e => e.includes("@"));
      // Capture each invite's shareable link + whether the email actually sent, so the UI can
      // ALWAYS surface a working link even when no verified mail domain is configured.
      const results = await Promise.all(list.map(async (email) => {
        try {
          const r = await apiClient.post<{ invite_link?: string; email_sent?: boolean }>("/invites", { email, role: "member" });
          return { email, link: r.invite_link ?? null, sent: !!r.email_sent, error: null as string | null };
        } catch (e) {
          // The API returns { error: "..." } as the body — surface it instead of a blank failure.
          let msg = e instanceof Error ? e.message : "could not create invite";
          try { msg = (JSON.parse(msg) as { error?: string }).error ?? msg; } catch { /* keep raw */ }
          return { email, link: null, sent: false, error: msg };
        }
      }));
      return results;
    },
    onSuccess: (results) => { setEmails(""); setInviteResults(results); refresh(); },
  });
  const revokeInvite = useMutation({ mutationFn: (id: string) => apiClient.delete(`/invites/${id}`), onSuccess: refresh });

  async function copyInviteLink() {
    try {
      const { invite_link } = await apiClient.post<{ invite_link: string }>("/invites/link", {});
      await navigator.clipboard.writeText(invite_link);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch (e) { console.error("[invite-link]", e); }
  }

  return (
    <div>
      {query.isError && (
        <div className="mb-4 rounded-sm border px-4 py-3 text-[12px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          Couldn't load members right now — showing what's cached. Try reloading.
        </div>
      )}
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: "var(--section-accent)" }}>// TEAM OPERATORS</p>
        <h1 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Members &amp; Roles</h1>
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>{members.length} operator{members.length === 1 ? "" : "s"} · roles, per-module access, and AI compute.</p>
      </div>

      {/* Single-operator plans can't invite — nudge to upgrade instead of showing a dead invite box. */}
      {isAdmin && !canInvite && (
        <div className="mb-5 rounded-sm border px-4 py-3 text-[12px]" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          Your plan is for a single operator. <a href="/settings/billing" className="underline" style={{ color: "var(--section-accent)" }}>Upgrade to Command</a> to invite your team.
        </div>
      )}

      {/* Invite bar */}
      {isAdmin && canInvite && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input
            value={emails} onChange={e => setEmails(e.target.value)} placeholder="teammate@company.com"
            className="min-w-[220px] flex-1 rounded-sm border bg-transparent px-3 py-2 text-sm outline-none focus:border-stone-500"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
          />
          <button onClick={() => sendInvite.mutate()} disabled={!emails.includes("@") || sendInvite.isPending}
            className="flex items-center gap-2 rounded-sm px-3.5 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--accent)" }}>
            <UserPlus size={14} /> {sendInvite.isPending ? "Inviting…" : "Invite"}
          </button>
          <button onClick={copyInviteLink}
            className="flex items-center gap-2 rounded-sm border px-3.5 py-2 text-sm font-medium transition-colors hover:text-[var(--text-primary)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            {copied ? <><Check size={14} className="text-emerald-400" /> Copied</> : <><Copy size={14} /> Copy link</>}
          </button>
        </div>
      )}

      {/* Invite results — ALWAYS show a shareable link (works with zero mail config); note whether
          the email was also delivered. This is what was missing: invites created but no link shown. */}
      {isAdmin && inviteResults.length > 0 && (
        <div className="mb-5 rounded-sm border p-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-stone-500">Invites created · share each link</span>
            <button onClick={() => setInviteResults([])} className="text-[11px] text-stone-500 hover:text-stone-300">Dismiss</button>
          </div>
          <div className="space-y-1.5">
            {inviteResults.map(iv => (
              <div key={iv.email} className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>
                <span className="w-44 shrink-0 truncate text-[12px] text-stone-300">{iv.email}</span>
                {iv.link ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-stone-500">{iv.link}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: iv.sent ? "#34d399" : "#a1a1aa" }}>{iv.sent ? "emailed ✓" : "link only"}</span>
                    <button onClick={() => { navigator.clipboard.writeText(iv.link!); setCopiedLink(iv.email); setTimeout(() => setCopiedLink(null), 1500); }}
                      className="shrink-0 rounded-sm border px-2 py-0.5 text-[11px] text-stone-300 hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border-soft)" }}>
                      {copiedLink === iv.email ? "Copied ✓" : "Copy"}
                    </button>
                  </>
                ) : <span className="text-[11px] text-rose-400">{iv.error ?? "could not create invite"}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Operator matrix */}
      <div className="minimal-sheet overflow-x-auto">
        <table className="minimal-table min-w-[720px] text-left text-sm">
          <thead>
            <tr>
              {["Operator", "Role", "Module access", "AI usage · 30d", "Last active", ""].map(h => (
                <th key={h || "x"} className={`text-[10px] uppercase tracking-wider text-stone-500 ${h === "AI usage · 30d" ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.isArray(members) && members.length > 0 ? members.map((m, i) => {
              const isOwner = m?.role === "owner";
              const isExpanded = expanded === m?.id && !!m?.id;
              return (
                <Fragment key={m?.id ?? `row-${i}`}>
                <tr className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                  <td className="py-3">
                    <div className="flex items-center gap-2.5">
                      {m?.image_url
                        ? <img src={m.image_url} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />
                        : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] text-[11px] font-semibold text-stone-300">
                            {(m?.name || m?.email || "?").trim().charAt(0).toUpperCase() || "?"}
                          </span>}
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-stone-200">{m?.name || m?.email || "Unknown Operator"}</div>
                        <div className="truncate text-[10.5px] text-stone-600">{m?.email || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    {isAdmin && !isOwner && m?.id ? (
                      <select value={m?.role ?? "member"} onChange={e => changeRole.mutate({ id: m.id!, role: e.target.value })}
                        className="rounded-lg border bg-transparent px-2 py-1 text-xs outline-none" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
                        {ROLE_OPTIONS.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    ) : (
                      <span className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>{roleLabel(m?.role)}</span>
                    )}
                  </td>
                  <td className="py-3">
                    {(() => {
                      const acc = m?.module_access ?? {};
                      const editable = modules.filter(md => (acc[md.key] ?? "edit") === "edit").length;
                      const viewable = modules.filter(md => (acc[md.key] ?? "edit") === "view").length;
                      return (
                        <button
                          onClick={() => setExpanded(expanded === m?.id ? null : (m?.id ?? null))}
                          disabled={!m?.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors hover:text-[var(--text-primary)]"
                          style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}
                        >
                          <SlidersHorizontal size={12} />
                          <span className="tabular-nums">{editable} edit · {viewable} view</span>
                        </button>
                      );
                    })()}
                  </td>
                  <td className="py-3 text-right">
                    <span className="inline-flex items-center gap-1 tabular-nums text-[12px]" style={{ color: (m?.tokens ?? 0) > 0 ? "var(--section-accent)" : "#52525b" }}>
                      <Cpu size={11} /> {fmt(m?.tokens ?? 0)}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-stone-500"><Clock size={11} /> {ago(m?.last_active)}</span>
                  </td>
                  <td className="py-3 text-right">
                    {isAdmin && !isOwner && m?.id && (
                      <button onClick={() => remove.mutate(m.id!)} className="text-stone-600 transition-colors hover:text-rose-400" title="Remove operator">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                    <td colSpan={6} className="px-3 py-4" style={{ background: "var(--surface-hover)" }}>
                      <p className="mb-3 text-[10px] uppercase tracking-wider text-stone-500">
                        Per-module access for {m?.name || m?.email || "this operator"}{isOwner ? " · owners always have full access" : ""}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {modules.map(md => {
                          const level = m?.module_access?.[md.key] ?? "edit";
                          return (
                            <div key={md.key} className="flex items-center justify-between gap-2 rounded-sm border px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
                              <div className="min-w-0">
                                <div className="text-[12px] text-stone-200">{md.label}</div>
                                {md.hint && <div className="truncate text-[10px] text-stone-600">{md.hint}</div>}
                              </div>
                              {isAdmin && !isOwner && m?.id ? (
                                <select
                                  value={level}
                                  onChange={e => changeModule.mutate({ id: m.id!, module: md.key, level: e.target.value })}
                                  className="shrink-0 rounded-lg border bg-transparent px-2 py-1 text-xs outline-none"
                                  style={{ borderColor: "var(--border-soft)", color: LEVEL_COLOR[level] ?? "var(--text-secondary)" }}
                                >
                                  {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              ) : (
                                <span className="shrink-0 text-xs" style={{ color: LEVEL_COLOR[level] ?? "#52525b" }}>
                                  {LEVELS.find(([v]) => v === level)?.[1] ?? "Edit"}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            }) : (
              <tr><td colSpan={6} className="p-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {query.isLoading ? "Loading operators…" : "No team operators registered."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-stone-500">Pending invitations</p>
          <div className="minimal-sheet">
            {invitations.map((inv, i) => (
              <div key={inv?.id ?? `inv-${i}`} className="flex items-center justify-between border-t px-4 py-2.5 first:border-t-0" style={{ borderColor: "var(--border-soft)" }}>
                <span className="text-[12.5px] text-stone-300">{inv?.email || "—"}</span>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-stone-500" style={{ borderColor: "var(--border-soft)" }}>{roleLabel(inv?.role)}</span>
                  {isAdmin && inv?.id && (
                    <button onClick={() => revokeInvite.mutate(inv.id!)} className="text-stone-600 transition-colors hover:text-rose-400" title="Revoke invite"><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
