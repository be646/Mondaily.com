import { useOrganizationList, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, Plus, Database, ListChecks, CheckSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface MyWorkspace {
  workspace_id: string; name: string; role: string;
  counts: { tasks: number; lists: number; nodes: number; deals: number };
}

/**
 * Workspace picker — shows every real Supabase workspace this user has a
 * workspace_members row for (with real data counts), not only Clerk orgs.
 * Built after a production incident where a stale/empty workspace_id made
 * a user's real data look "missing" — this page exists so a user (or
 * support) can always see and pick the workspace that actually has data,
 * never guessing from a cached localStorage value. Read-only: selecting a
 * workspace below never creates or deletes anything.
 */
export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { userMemberships, setActive } = useOrganizationList({ userMemberships: { infinite: true } });
  const orgMemberships = userMemberships?.data ?? [];

  const myWorkspacesQuery = useQuery({
    queryKey: ["workspaces", "mine"],
    queryFn: async () => {
      const token = await getToken();
      const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
      const res = await fetch(`${apiBase}/api/v1/workspaces/mine`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to load workspaces");
      const data = await res.json() as { workspaces: MyWorkspace[] };
      return data.workspaces;
    },
  });
  const myWorkspaces = myWorkspacesQuery.data ?? [];

  async function selectOrg(organizationId: string, orgName: string) {
    await setActive?.({ organization: organizationId });
    try {
      const token = await getToken();
      const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
      const res = await fetch(`${apiBase}/api/v1/onboarding/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ clerk_org_id: organizationId, name: orgName }),
      });
      if (res.ok) {
        const { workspace_id } = (await res.json()) as { workspace_id: string };
        localStorage.setItem("mondaily_workspace_id", workspace_id);
      }
    } catch { /* non-fatal */ }
    navigate("/home");
  }

  function selectWorkspaceId(workspaceId: string) {
    localStorage.setItem("mondaily_workspace_id", workspaceId);
    navigate("/home");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#0d0d0d] px-6 text-white">
      <div className="w-full max-w-md">
        <Building2 className="mx-auto mb-4 text-red-500" />
        <h1 className="text-center text-xl font-semibold">Choose a workspace</h1>
        <p className="mb-7 mt-1 text-center text-sm text-stone-500">
          {myWorkspacesQuery.isLoading ? "Loading your workspaces…" : `${myWorkspaces.length} workspace${myWorkspaces.length === 1 ? "" : "s"} with your data`}
        </p>

        {myWorkspacesQuery.isError && (
          <p className="mb-3 text-center text-xs text-rose-400">Couldn't load your workspaces — try refreshing.</p>
        )}

        <div className="space-y-2">
          {myWorkspaces.map(ws => (
            <button key={ws.workspace_id} onClick={() => selectWorkspaceId(ws.workspace_id)} className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-3 text-left hover:bg-white/[.04]">
              <div className="grid h-9 w-9 place-items-center rounded-md bg-red-500/10 text-sm font-semibold text-red-400">{ws.name.charAt(0)}</div>
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

        {orgMemberships.length > 0 && (
          <>
            <p className="mb-2 mt-5 text-[11px] uppercase tracking-widest text-stone-600">Organizations</p>
            <div className="space-y-2">
              {orgMemberships.map(({ organization, role }) => (
                <button key={organization.id} onClick={() => selectOrg(organization.id, organization.name)} className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-3 text-left hover:bg-white/[.04]">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-red-500/10 text-sm font-semibold text-red-400">{organization.name.charAt(0)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{organization.name}</p>
                    <p className="text-xs capitalize text-stone-500">{role.replace("org:", "")}</p>
                  </div>
                  <ArrowRight size={15} className="text-stone-600" />
                </button>
              ))}
            </div>
          </>
        )}

        <button onClick={() => navigate("/onboarding/workspace")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 p-3 text-sm text-stone-400 hover:text-white">
          <Plus size={15} /> Create new workspace
        </button>
      </div>
    </div>
  );
}
