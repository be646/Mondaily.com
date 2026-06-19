import { useOrganizationList, useAuth } from "@clerk/react";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const { userMemberships, setActive } = useOrganizationList({ userMemberships: { infinite: true } });
  const memberships = userMemberships?.data ?? [];

  async function selectWorkspace(organizationId: string, orgName: string) {
    await setActive?.({ organization: organizationId });
    // Exchange Clerk org ID for Supabase workspace UUID
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

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b0d10] px-6 text-white">
      <div className="w-full max-w-sm">
        <Building2 className="mx-auto mb-4 text-red-500" />
        <h1 className="text-center text-xl font-semibold">Choose a workspace</h1>
        <p className="mb-7 mt-1 text-center text-sm text-slate-500">{memberships.length} available workspace{memberships.length === 1 ? "" : "s"}</p>
        <div className="space-y-2">
          {memberships.map(({ organization, role }) => (
            <button key={organization.id} onClick={() => selectWorkspace(organization.id, organization.name)} className="flex w-full items-center gap-3 rounded-lg border border-white/10 p-3 text-left hover:bg-white/[.04]">
              <div className="grid h-9 w-9 place-items-center rounded-md bg-red-500/10 text-sm font-semibold text-red-400">{organization.name.charAt(0)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{organization.name}</p>
                <p className="text-xs capitalize text-slate-500">{role.replace("org:", "")}</p>
              </div>
              <ArrowRight size={15} className="text-slate-600" />
            </button>
          ))}
        </div>
        <button onClick={() => navigate("/onboarding/workspace")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 p-3 text-sm text-slate-400 hover:text-white">
          <Plus size={15} /> Create new workspace
        </button>
      </div>
    </div>
  );
}
