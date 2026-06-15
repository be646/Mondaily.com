import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";

interface WorkspaceSettings { name: string; timezone: string; modules: string[] }

export function useModules() {
  const { data } = useQuery<WorkspaceSettings>({
    queryKey: ["workspace-settings"],
    queryFn: () => apiClient.get<WorkspaceSettings>("/settings/workspace"),
    staleTime: 300_000,
  });
  const modules = data?.modules ?? ["crm"];
  return {
    hasFinance: modules.includes("finance"),
    hasCRM: modules.includes("crm"),
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
