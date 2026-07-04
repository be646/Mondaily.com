import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/api-client";
import type { WorkspaceProfile } from "@mondaily/shared/profile";

export interface ProfileRecommendations {
  agents: string[];
  automations: string[];
  object_types: string[];
  discovery_searches: string[];
}

export interface WorkspaceSuggestions {
  profile: WorkspaceProfile;
  // Discovery
  discovery: string[];              // industry-aware Discovery search examples
  discovery_placeholder: string;    // search-box placeholder
  discovery_next: string[];         // "what to search next"
  deep_research: string;            // deep-research framing hint
  // Ask + Home
  ask: string[];                    // industry-aware Ask starter prompts
  home: { key: string; prompt: string }[]; // profile-aware Home quick prompts
  // Builders
  objects: string[];                // canonical object nouns for this workspace
  object_examples: string[];        // object-type creation examples
  list_examples: string[];          // list/sheet creation examples
  table_examples: string[];         // record-table NLP examples
  import_examples: string[];        // import examples
  // Terms + recommendations
  terms: Record<string, string>;    // preferred terminology overrides
  recommendations: ProfileRecommendations;
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
