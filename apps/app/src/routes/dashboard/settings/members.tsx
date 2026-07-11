import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import { Check, Copy, Trash2, UserPlus, Cpu, Clock, SlidersHorizontal } from "lucide-react";
import { Fragment, useState } from "react";
import { apiClient } from "../../../lib/api-client";
import { FieldSelect } from "../../../components/ui/controls";
import { PageHeader } from "../../../components/ui/page-state";

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
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // IMPORTANT: distinct key. This endpoint returns an OBJECT {members, invitations, modules,...},
  // whereas the app-wide ["members"] key returns an ARRAY (/members). Sharing the key overwrote the
  // array cache with an object, and array consumers (sidebar-lists, board, tasks...) threw on
  // .map/.filter — which crashed the sidebar into its fallback when this page loaded.
  const query = useQuery({ queryKey: ["settings-members"], queryFn: () => apiClient.get<MembersData>("/settings/members"), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["settings-members"] });

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
  // Bulk access: send a full module_access map. {} clears overrides → back to role defaults.
  const setAllModules = useMutation({ mutationFn: ({ id, map }: { id: string; map: Record<string, string> }) => apiClient.patch(`/settings/members/${id}`, { module_access: map }), onSuccess: refresh });
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
      {/* Shared PageHeader — same page-header pattern as every other settings page. */}
      <PageHeader title="Members & Roles" description={`${members.length} operator${members.length === 1 ? "" : "s"} · roles, per-module access, and AI compute.`} />

      {/* How access works — role sets the baseline, per-module access refines it. Clarifies the two
          distinct controls (revoke a single module vs remove the operator entirely). */}
      {isAdmin && (
        <div className="mb-5 rounded-sm border px-4 py-3 text-[11.5px] leading-relaxed" style={{ borderColor: "var(--border-soft)", color: "var(--text-muted)" }}>
          <span style={{ color: "var(--text-secondary)" }}>How access works:</span> a <strong>Role</strong> sets the baseline (Owner/Admin = full, Member = edit, Viewer = read-only).
          Open <strong>Module access</strong> to refine per feature — set any module to <span style={{ color: LEVEL_COLOR.none }}>None</span> / <span style={{ color: LEVEL_COLOR.view }}>View</span> / <span style={{ color: LEVEL_COLOR.edit }}>Edit</span>, or use <em>Revoke all</em> / <em>Reset to defaults</em>. The trash icon removes the operator from the workspace entirely.
        </div>
      )}

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
            className="h-9 min-w-[220px] flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus:border-[color:var(--section-accent)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-primary)" }}
          />
          <button onClick={() => sendInvite.mutate()} disabled={!emails.includes("@") || sendInvite.isPending}
            className="flex h-9 items-center gap-2 rounded-md px-4 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--accent)" }}>
            <UserPlus size={14} /> {sendInvite.isPending ? "Inviting…" : "Invite"}
          </button>
          <button onClick={copyInviteLink}
            className="flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors hover:border-[color:var(--section-accent)] hover:text-[var(--text-primary)]"
            style={{ borderColor: "var(--border-soft)", color: "var(--text-secondary)" }}>
            {copied ? <><Check size={14} className="text-[#5f8169]" /> Copied</> : <><Copy size={14} /> Copy link</>}
          </button>
        </div>
      )}

      {/* Invite results — ALWAYS show a shareable link (works with zero mail config); note whether
          the email was also delivered. This is what was missing: invites created but no link shown. */}
      {isAdmin && inviteResults.length > 0 && (
        <div className="mb-5 rounded-sm border p-3" style={{ borderColor: "var(--border-soft)" }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">Invites created · share each link</span>
            <button onClick={() => setInviteResults([])} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-faint)]">Dismiss</button>
          </div>
          <div className="space-y-1.5">
            {inviteResults.map(iv => (
              <div key={iv.email} className="flex items-center gap-2 rounded-sm border px-2.5 py-1.5" style={{ borderColor: "var(--border-soft)" }}>
                <span className="w-44 shrink-0 truncate text-[12px] text-[var(--text-faint)]">{iv.email}</span>
                {iv.link ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">{iv.link}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: iv.sent ? "#34d399" : "#a1a1aa" }}>{iv.sent ? "emailed ✓" : "link only"}</span>
                    <button onClick={() => { navigator.clipboard.writeText(iv.link!); setCopiedLink(iv.email); setTimeout(() => setCopiedLink(null), 1500); }}
                      className="shrink-0 rounded-sm border px-2 py-0.5 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border-soft)" }}>
                      {copiedLink === iv.email ? "Copied ✓" : "Copy"}
                    </button>
                  </>
                ) : <span className="text-[11px] text-[#9c6b72]">{iv.error ?? "could not create invite"}</span>}
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
                <th key={h || "x"} className={`whitespace-nowrap text-[10px] uppercase tracking-wider text-[var(--text-muted)] ${h === "AI usage · 30d" ? "text-right" : ""}`}>{h}</th>
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
                        : <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--border-soft)] bg-[var(--surface-hover)] text-[11px] font-semibold text-[var(--text-faint)]">
                            {(m?.name || m?.email || "?").trim().charAt(0).toUpperCase() || "?"}
                          </span>}
                      <div className="min-w-0 max-w-[240px]">
                        <div className="truncate text-[13px] text-[var(--text-primary)]">{m?.name || m?.email || "Unknown Operator"}</div>
                        <div className="truncate text-[10.5px] text-[var(--text-muted)]">{m?.email || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3">
                    {isAdmin && !isOwner && m?.id ? (
                      <FieldSelect value={m?.role ?? "member"} onChange={v => changeRole.mutate({ id: m.id!, role: v })}
                        ariaLabel="Role"
                        options={ROLE_OPTIONS.map(r => ({ value: r, label: roleLabel(r) }))} />
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
                          className="inline-flex w-max shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-[color:var(--section-accent)] hover:text-[var(--text-primary)]"
                          style={{ borderColor: expanded === m?.id ? "var(--section-accent)" : "var(--border-soft)", background: "var(--surface-card)", color: "var(--text-secondary)" }}
                        >
                          <SlidersHorizontal size={12} className="shrink-0" />
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
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-muted)]"><Clock size={11} /> {ago(m?.last_active)}</span>
                  </td>
                  <td className="py-3 text-right">
                    {isAdmin && !isOwner && m?.id && (
                      confirmRemove === m.id ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px]">
                          <span className="text-[var(--text-faint)]">Remove?</span>
                          <button onClick={() => { remove.mutate(m.id!); setConfirmRemove(null); }}
                            className="rounded-md border border-[#9c6b72]/40 px-2 py-1 font-medium text-[#9c6b72] hover:bg-[#9c6b72]/10">Yes, remove</button>
                          <button onClick={() => setConfirmRemove(null)}
                            className="rounded-md border px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border-soft)" }}>Cancel</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmRemove(m.id!)} className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[#9c6b72]/10 hover:text-[#9c6b72]" title="Remove operator">
                          <Trash2 size={14} />
                        </button>
                      )
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-t" style={{ borderColor: "var(--border-soft)" }}>
                    <td colSpan={6} className="px-3 py-4" style={{ background: "var(--surface-hover)" }}>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                          Per-module access for {m?.name || m?.email || "this operator"}{isOwner ? " · owners always have full access" : ""}
                        </p>
                        {isAdmin && !isOwner && m?.id && (
                          <div className="flex items-center gap-2">
                            <button onClick={() => setAllModules.mutate({ id: m.id!, map: Object.fromEntries(modules.map(md => [md.key, "none"])) })}
                              className="rounded-md border px-2 py-1 text-[11px] text-[var(--text-faint)] transition-colors hover:border-[#9c6b72]/40 hover:text-[#9c6b72]" style={{ borderColor: "var(--border-soft)" }}>
                              Revoke all access
                            </button>
                            <button onClick={() => setAllModules.mutate({ id: m.id!, map: {} })}
                              className="rounded-md border px-2 py-1 text-[11px] text-[var(--text-faint)] transition-colors hover:border-[color:var(--section-accent)] hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border-soft)" }}>
                              Reset to role defaults
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {modules.map(md => {
                          const level = m?.module_access?.[md.key] ?? "edit";
                          return (
                            <div key={md.key} className="flex items-center justify-between gap-2 rounded-sm border px-3 py-2" style={{ borderColor: "var(--border-soft)" }}>
                              <div className="min-w-0">
                                <div className="text-[12px] text-[var(--text-primary)]">{md.label}</div>
                                {md.hint && <div className="truncate text-[10px] text-[var(--text-muted)]">{md.hint}</div>}
                              </div>
                              {isAdmin && !isOwner && m?.id ? (
                                <FieldSelect
                                  value={level}
                                  onChange={v => changeModule.mutate({ id: m.id!, module: md.key, level: v })}
                                  ariaLabel={`${md.label} access`}
                                  className="shrink-0"
                                  options={LEVELS.map(([v, l]) => ({ value: v, label: l }))}
                                />
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
          <p className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Pending invitations</p>
          <div className="minimal-sheet">
            {invitations.map((inv, i) => (
              <div key={inv?.id ?? `inv-${i}`} className="flex items-center justify-between border-t px-4 py-2.5 first:border-t-0" style={{ borderColor: "var(--border-soft)" }}>
                <span className="text-[12.5px] text-[var(--text-faint)]">{inv?.email || "—"}</span>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]" style={{ borderColor: "var(--border-soft)" }}>{roleLabel(inv?.role)}</span>
                  {isAdmin && inv?.id && (
                    confirmRevoke === inv.id ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px]">
                        <button onClick={() => { revokeInvite.mutate(inv.id!); setConfirmRevoke(null); }}
                          className="rounded-md border border-[#9c6b72]/40 px-2 py-1 font-medium text-[#9c6b72] hover:bg-[#9c6b72]/10">Revoke</button>
                        <button onClick={() => setConfirmRevoke(null)} className="rounded-md border px-2 py-1 text-[var(--text-faint)] hover:text-[var(--text-primary)]" style={{ borderColor: "var(--border-soft)" }}>Cancel</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmRevoke(inv.id!)} className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[#9c6b72]/10 hover:text-[#9c6b72]" title="Revoke invite"><Trash2 size={13} /></button>
                    )
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
