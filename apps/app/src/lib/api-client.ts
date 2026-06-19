const BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API_URL = `${BASE_URL}/api/v1`;

// Clerk's getToken function — set once by AuthGate on mount so the api client
// can fetch a fresh token on every request without needing React context.
let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>) {
  _getToken = fn;
}

// Returns Authorization + X-Workspace-Id headers using the Clerk token provider.
// Use this everywhere instead of reading mondaily_session_token from localStorage
// (that key is never written and will always be null).
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = _getToken ? await _getToken() : null;
  const workspaceId = localStorage.getItem("mondaily_workspace_id");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = _getToken ? await _getToken() : null;
  const workspaceId = localStorage.getItem("mondaily_workspace_id");

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `${init?.method || "GET"} ${path} failed`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: JSON.stringify(body) });
  },
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
  },
  async delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  }
};
