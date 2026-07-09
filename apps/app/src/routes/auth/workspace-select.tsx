import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Plus, Database, ListChecks, CheckSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../../lib/api-client";

interface MyWorkspace {
  workspace_id: string; name: string; role: string;
  counts: { tasks: number; lists: number; nodes: number; deals: number };
}

/**
 * Workspace picker — shows every Supabase workspace this user has a workspace_members row for
 * (with real data counts). Read-only: selecting one only sets the active workspace locally.
 */
export function WorkspaceSelectPage() {
  const navigate = useNavigate();

  const myWorkspacesQuery = useQuery({
    queryKey: ["workspaces", "mine"],
    queryFn: () => apiClient.get<{ workspaces: MyWorkspace[] }>("/workspaces/mine").then(d => d.workspaces),
  });
  const myWorkspaces = myWorkspacesQuery.data ?? [];

  function selectWorkspaceId(workspaceId: string) {
    localStorage.setItem("mondaily_workspace_id", workspaceId);
    navigate("/home");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[var(--surface-page)] px-6 text-[var(--text-primary)]">
      <div className="w-full max-w-md">
        <Building2 className="mx-auto mb-4 text-[#9c6b72]" />
        <h1 className="text-center text-xl font-semibold">Choose a workspace</h1>
        <p className="mb-7 mt-1 text-center text-sm text-stone-500">
          {myWorkspacesQuery.isLoading ? "Loading your workspaces…" : `${myWorkspaces.length} workspace${myWorkspaces.length === 1 ? "" : "s"} with your data`}
        </p>

        {myWorkspacesQuery.isError && (
          <p className="mb-3 text-center text-xs text-[#9c6b72]">Couldn't load your workspaces — try refreshing.</p>
        )}

        <div className="space-y-2">
          {myWorkspaces.map(ws => (
            <button key={ws.workspace_id} onClick={() => selectWorkspaceId(ws.workspace_id)} className="flex w-full items-center gap-3 rounded-lg border border-[var(--border-soft)] p-3 text-left hover:bg-[var(--surface-hover)]">
              <div className="grid h-9 w-9 place-items-center rounded-md bg-[#9c6b72]/10 text-sm font-semibold text-[#9c6b72]">{ws.name.charAt(0)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ws.name}</p>
                <p className="flex items-center gap-3 text-[11px] text-stone-500">
                  <span className="flex items-center gap-1"><CheckSquare size={10}/>{ws.counts.tasks} tasks</span>
                  <span className="flex items-center gap-1"><ListChecks size={10}/>{ws.counts.lists} lists</span>
                  <span className="flex items-center gap-1"><Database size={10}/>{ws.counts.nodes} records</span>
                </p>
              </div>
              <ArrowRight size={15} className="text-stone-600" />
            </button>
          ))}
        </div>

        <button onClick={() => navigate("/onboarding")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-soft)] p-3 text-sm text-stone-400 hover:text-[var(--text-primary)]">
          <Plus size={15} /> Create new workspace
        </button>
      </div>
    </div>
  );
}
