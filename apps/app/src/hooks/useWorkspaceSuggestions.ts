import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";
import type { WorkspaceProfile } from "@mondaily/shared/profile";

export interface WorkspaceSuggestions {
  profile: WorkspaceProfile;
  discovery: string[];   // industry-aware Discovery search examples
  ask: string[];         // industry-aware Ask starter prompts
  objects: string[];     // canonical object nouns for this workspace
  terms: Record<string, string>; // preferred terminology overrides
}

/**
 * Industry-aware suggestions derived from the workspace profile (GET /workspace/suggestions).
 * The backend always returns sensible values — neutral generic ones when the profile is empty — so
 * callers can render `data.discovery` / `data.ask` directly, or fall back to their own static list
 * while loading. Never blocks a surface: on error the query simply has no data and the caller's
 * static fallback shows.
 */
export function useWorkspaceSuggestions() {
  return useQuery<WorkspaceSuggestions>({
    queryKey: ["workspace-suggestions"],
    queryFn: () => apiClient.get<WorkspaceSuggestions>("/workspace/suggestions"),
    staleTime: 300_000,
    retry: false,
  });
}
