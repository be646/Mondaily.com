import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";

interface WorkspaceSettings { name: string; timezone: string; modules: string[] }

interface MyAccess { role: string; enabled_modules: string[]; access: Record<string, string> }

export function useModules() {
  const { data } = useQuery<WorkspaceSettings>({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get<WorkspaceSettings>("/settings/workspace"),
    staleTime: 300_000,
  });
  // The CURRENT user's effective per-module access — so nav reflects what THEY can reach, not just
  // what the workspace enables. A module shows only when it's enabled AND the user has ≥ view.
  const { data: mine } = useQuery<MyAccess>({
    queryKey: ["my-access"],
    queryFn: () => apiClient.get<MyAccess>("/me/access"),
    staleTime: 300_000,
  });
  const modules = data?.modules ?? [];
  const canSee = (key: string) => {
    const enabled = key === "finance" || key === "investments" || key === "hr" ? modules.includes(key) : true;
    // Until /me/access resolves, don't hide (avoid a flash of missing nav for owners).
    const level = mine?.access?.[key];
    const allowed = level === undefined ? true : level !== "none";
    return enabled && allowed;
  };
  return {
    hasFinance: canSee("finance"),
    hasCRM: modules.includes("crm"),
    hasInvestments: canSee("investments"),
    hasHR: canSee("hr"),
    canSee,
    access: mine?.access ?? {},
    modules,
  };
}

export interface WorkspaceMember {
  user_id: string;
  role: string;
  finance_role: string;
}

export function useWorkspaceMembers() {
  return useQuery<WorkspaceMember[]>({
    queryKey: ["workspace-members"],
    queryFn: () => apiClient.get<WorkspaceMember[]>("/workspace/members"),
    staleTime: 60_000,
  });
}

export function useFinanceRole(currentUserId?: string) {
  const { data: members = [] } = useWorkspaceMembers();
  const me = members.find((m) => m.user_id === currentUserId);
  if (!me) return "none";
  // admin/owner automatically acts as approver
  if (["admin", "owner"].includes(me.role)) return "approver";
  return me.finance_role ?? "none";
}
