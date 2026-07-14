import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2, LogIn, Plus, RefreshCw, LayoutGrid, ChevronDown } from "lucide-react";
import { apiClient } from "../lib/api-client";
import { useSovereignAuth } from "./auth/sovereign-auth-context";
import { LogoMark } from "./logo";

/**
 * Workspace / session diagnostic — a calm, honest panel shown by DashboardRoute when the dashboard
 * genuinely cannot resolve real workspace data, INSTEAD of silently bouncing to onboarding or
 * rendering an empty Home. It never renders for a normal working user (valid workspace id passes
 * straight through in DashboardRoute). No schema/auth changes: it reads the existing sovereign-auth
 * context and probes the existing /workspaces/mine endpoint to tell the cases apart.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MyWorkspace = { workspace_id: string; name: string; role?: string };

type DiagCase =
  | "loading"
  | "not_signed_in"
  | "api_unreachable"
  | "no_workspaces"
  | "workspace_missing"       // authed, has ≥1 workspace, but no id stored (or invalid) → recoverable
  | "invalid_workspace_id";

function readStoredWorkspace(): string | null {
  try { return localStorage.getItem("mondaily_workspace_id"); } catch { return null; }
}

export function WorkspaceDiagnostic() {
  const navigate = useNavigate();
  const { status, user, logout } = useSovereignAuth();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stored = readStoredWorkspace();
  const invalidFormat = Boolean(stored && !UUID_RE.test(stored));

  // Probe the user's real workspace list. Only when authenticated — this is what distinguishes
  // "API down" from "no membership" from "just lost the stored id".
  const probe = useQuery({
    queryKey: ["ws-diagnostic", "mine"],
    queryFn: () => apiClient.get<{ workspaces: MyWorkspace[] }>("/workspaces/mine").then((d) => d.workspaces ?? []),
    enabled: status === "authenticated",
    retry: 1,
    staleTime: 0,
  });

  const workspaces = probe.data ?? [];

  const diag: DiagCase = useMemo(() => {
    if (status === "loading") return "loading";
    if (status === "unauthenticated") return "not_signed_in";
    if (probe.isLoading) return "loading";
    if (probe.isError) return "api_unreachable";
    if (workspaces.length === 0) return "no_workspaces";
    if (invalidFormat) return "invalid_workspace_id";
    return "workspace_missing";
  }, [status, probe.isLoading, probe.isError, workspaces.length, invalidFormat]);

  // Auto-recover the common, boring case: the user genuinely has exactly one workspace but the
  // stored id was cleared/stale (e.g. after a cache wipe). Re-seed it and continue — no dead-end,
  // no onboarding detour. Only when there's a single unambiguous choice.
  useEffect(() => {
    if ((diag === "workspace_missing" || diag === "invalid_workspace_id") && workspaces.length === 1) {
      try {
        localStorage.setItem("mondaily_workspace_id", workspaces[0]!.workspace_id);
        window.location.reload();
      } catch { /* fall through to manual choice */ }
    }
  }, [diag, workspaces]);

  const selectWorkspace = (id: string) => {
    try { localStorage.setItem("mondaily_workspace_id", id); } catch { /* ignore */ }
    window.location.assign("/home");
  };

  if (diag === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-faint)" }} />
      </div>
    );
  }

  const COPY: Record<Exclude<DiagCase, "loading">, { title: string; body: string }> = {
    not_signed_in: { title: "Your session has ended", body: "We couldn't confirm you're signed in. Sign in again to get back to your workspace." },
    api_unreachable: { title: "Can't reach Mondaily right now", body: "Your account is fine — the service didn't respond. This is usually momentary. Retry, or check the status page." },
    no_workspaces: { title: "No workspace yet", body: "You're signed in, but this account isn't a member of any workspace. Create one to get started." },
    workspace_missing: { title: "Pick a workspace", body: "You're signed in and have workspaces, but none is currently selected. Choose one to continue." },
    invalid_workspace_id: { title: "Workspace selection needs resetting", body: "The stored workspace reference is invalid. Pick a workspace to reset it." },
  };
  const copy = COPY[diag];

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 py-12">
      <div className="w-full rounded-sm border p-6" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: "var(--surface-hover)" }}>
            {diag === "api_unreachable" ? <AlertTriangle size={15} style={{ color: "#c6892e" }} /> : <LogoMark size={15} style={{ color: "var(--section-accent)" }} />}
          </span>
          <div>
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--text-primary)" }}>{copy.title}</p>
            <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>Workspace diagnostic</p>
          </div>
        </div>

        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{copy.body}</p>

        {/* Workspace picker — when the user has choices */}
        {(diag === "workspace_missing" || diag === "invalid_workspace_id") && workspaces.length > 1 && (
          <div className="mt-4 space-y-1.5">
            {workspaces.map((ws) => (
              <button key={ws.workspace_id} onClick={() => selectWorkspace(ws.workspace_id)}
                className="flex w-full items-center justify-between gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors hover:border-[color:var(--section-accent)]"
                style={{ borderColor: "var(--border-soft)" }}>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>{ws.name}</span>
                <ArrowRight size={13} className="shrink-0" style={{ color: "var(--text-faint)" }} />
              </button>
            ))}
          </div>
        )}

        {/* Primary actions per case */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {diag === "not_signed_in" && (
            <button onClick={() => { void logout().finally(() => navigate("/auth/shadow-login")); }} className="btn-suggested inline-flex items-center gap-1.5 !text-[12px]">
              <LogIn size={13} /> Sign in again
            </button>
          )}
          {diag === "api_unreachable" && (
            <>
              <button onClick={() => probe.refetch()} disabled={probe.isFetching} className="btn-suggested inline-flex items-center gap-1.5 !text-[12px]">
                {probe.isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry
              </button>
              <button onClick={() => navigate("/status")} className="btn-secondary inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-[12px]">
                View status
              </button>
            </>
          )}
          {diag === "no_workspaces" && (
            <button onClick={() => navigate("/onboarding")} className="btn-suggested inline-flex items-center gap-1.5 !text-[12px]">
              <Plus size={13} /> Create your workspace
            </button>
          )}
          {(diag === "workspace_missing" || diag === "invalid_workspace_id") && (
            <>
              <button onClick={() => navigate("/workspaces")} className="btn-suggested inline-flex items-center gap-1.5 !text-[12px]">
                <LayoutGrid size={13} /> Switch workspace
              </button>
              <button onClick={() => navigate("/onboarding")} className="btn-secondary inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-[12px]">
                <Plus size={13} /> New workspace
              </button>
            </>
          )}
        </div>

        {/* Technical details — hidden by default */}
        <button onClick={() => setDetailsOpen((o) => !o)} className="mt-5 inline-flex items-center gap-1 text-[11px] transition-colors hover:text-[var(--text-secondary)]" style={{ color: "var(--text-faint)" }}>
          <ChevronDown size={11} className={`transition-transform ${detailsOpen ? "rotate-180" : ""}`} /> Details
        </button>
        {detailsOpen && (
          <dl className="mt-2 space-y-1 rounded-sm border p-3 font-mono text-[10.5px]" style={{ borderColor: "var(--border-soft)", background: "var(--surface-hover)", color: "var(--text-muted)" }}>
            <div className="flex justify-between gap-3"><dt style={{ color: "var(--text-faint)" }}>case</dt><dd>{diag}</dd></div>
            <div className="flex justify-between gap-3"><dt style={{ color: "var(--text-faint)" }}>auth</dt><dd>{status}{user?.userId ? ` · ${user.userId.slice(0, 12)}…` : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt style={{ color: "var(--text-faint)" }}>stored ws</dt><dd className="max-w-[60%] truncate">{stored ?? "—"}{invalidFormat ? " (invalid)" : ""}</dd></div>
            <div className="flex justify-between gap-3"><dt style={{ color: "var(--text-faint)" }}>/workspaces/mine</dt><dd>{probe.isError ? "error" : `${workspaces.length} found`}</dd></div>
          </dl>
        )}
      </div>
    </div>
  );
}
