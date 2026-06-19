import { getAuthHeaders } from "./api-client";

export interface ChatMessage { role: "user" | "assistant"; content: string; }
export interface ChatThread { id: string; title: string; messages: ChatMessage[]; updatedAt: number; }

const KEY = "mondaily_chat_threads";

export function getThreads(): ChatThread[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as ChatThread[]; } catch { return []; }
}

export function saveThreads(threads: ChatThread[]) {
  try { localStorage.setItem(KEY, JSON.stringify(threads)); } catch {}
}

export function createThread(firstMessage: string): ChatThread {
  const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
  return { id: uuid, title: firstMessage.slice(0, 45), messages: [], updatedAt: Date.now() };
}

export function addMessageToThread(threadId: string, message: ChatMessage): void {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.id === threadId);
  if (idx === -1) return;
  const thread = threads[idx];
  if (!thread) return;
  const updated: ChatThread = { ...thread, messages: [...thread.messages, message], updatedAt: Date.now() };
  const newThreads: ChatThread[] = [updated, ...threads.filter(t => t.id !== threadId)];
  saveThreads(newThreads);
  // Sync to server in background
  syncThreadToServer(updated).catch(() => {});
}

async function syncThreadToServer(thread: ChatThread): Promise<void> {
  const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
  const headers = await getAuthHeaders();
  // Check if thread exists on server
  const res = await fetch(`${apiUrl}/api/v1/chats/${thread.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: thread.title, messages: thread.messages })
  });
  if (res.status === 404 || res.status === 500) {
    // Create it
    await fetch(`${apiUrl}/api/v1/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: thread.title, messages: thread.messages })
    });
  }
}

export async function loadThreadsFromServer(): Promise<ChatThread[]> {
  try {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
    const headers = await getAuthHeaders();
    const res = await fetch(`${apiUrl}/api/v1/chats`, { headers });
    if (!res.ok) return getThreads();
    const data = await res.json() as any[];
    const threads: ChatThread[] = data.map(t => ({
      id: t.id,
      title: t.title,
      messages: t.messages as ChatMessage[],
      updatedAt: new Date(t.updated_at).getTime()
    }));
    saveThreads(threads);
    return threads;
  } catch {
    return getThreads();
  }
}

export async function deleteThreadFromServer(threadId: string): Promise<void> {
  try {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
    const headers = await getAuthHeaders();
    await fetch(`${apiUrl}/api/v1/chats/${threadId}`, { method: "DELETE", headers });
  } catch {}
}
