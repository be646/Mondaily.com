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
