import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { apiClient } from "../lib/api-client";

/**
 * /restore — the deletion email's landing page. Restores a soft-deleted workspace (owner-only,
 * inside the 14-day window). Lives OUTSIDE the dashboard shell on purpose: the deleted workspace
 * answers 410 to every normal request, so the shell can't load — this page only needs the auth
 * cookie and the workspace id from the link.
 */
export function RestoreWorkspacePage() {
  const [params] = useSearchParams();
  const ws = params.get("ws") ?? "";
  const [state, setState] = useState<{ kind: "working" | "done" | "already" | "error"; msg?: string; name?: string | null }>({ kind: "working" });

  useEffect(() => {
    if (!ws) { setState({ kind: "error", msg: "The restore link is missing its workspace id." }); return; }
    apiClient.post<{ ok?: boolean; restored?: boolean; already_active?: boolean; name?: string | null; error?: string }>("/auth/restore-workspace", { workspace_id: ws })
      .then(r => {
        if (r.already_active) setState({ kind: "already" });
        else if (r.ok) setState({ kind: "done", name: r.name });
        else setState({ kind: "error", msg: r.error ?? "Could not restore the workspace." });
      })
      .catch(e => setState({ kind: "error", msg: e instanceof Error ? e.message : "Could not restore the workspace." }));
  }, [ws]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: "var(--surface-page)" }}>
      <div className="w-full max-w-md rounded-md border p-6 text-center" style={{ borderColor: "var(--border-soft)", background: "var(--surface-card)" }}>
        {state.kind === "working" && <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>Restoring the workspace…</p>}
        {state.kind === "done" && (<>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>Workspace restored</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>{state.name ?? "Your workspace"} is active again — nothing was erased.</p>
        </>)}
        {state.kind === "already" && <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>This workspace is already active — nothing to restore.</p>}
        {state.kind === "error" && (<>
          <p className="text-[14px] font-semibold" style={{ color: "var(--status-error)" }}>Couldn't restore</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-muted)" }}>{state.msg}</p>
        </>)}
        {state.kind !== "working" && (
          <Link to="/home" className="btn-primary mt-5 inline-flex h-8 items-center px-4 text-[12.5px] font-semibold">Open Mondaily</Link>
        )}
      </div>
    </div>
  );
}
