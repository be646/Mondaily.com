const BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const API_URL = `${BASE_URL}/api/v1`;

function requestHeaders(): HeadersInit {
  const token = localStorage.getItem("mondaily_session_token");
  const workspaceId = localStorage.getItem("mondaily_workspace_id");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...requestHeaders(), ...init?.headers }
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
