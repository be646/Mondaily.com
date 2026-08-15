import { apiFetch, getAuthHeaders } from "./api-client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Raw backend source metadata, persisted so reopening a thread still shows
   *  the records/cards the AI found (not just the text answer). */
  sources?: unknown[];
  /** Phase-2B memory disclosure, persisted so "Used N remembered facts" survives
   *  thread reload / component remount (not just the live turn). */
  memory?: { used: number; refs: string[] };
}
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


/** Drop everything from `fromIndex` on — the edit-and-rerun path removes the last exchange before
 *  resending, and the stored thread must match what the screen shows or reopening it resurrects
 *  the corrected-away question. */
export function truncateThread(threadId: string, fromIndex: number): void {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.id === threadId);
  const thread = threads[idx];
  if (!thread) return;
  const updated: ChatThread = { ...thread, messages: thread.messages.slice(0, fromIndex), updatedAt: Date.now() };
  saveThreads([updated, ...threads.filter(t => t.id !== threadId)]);
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
  syncThreadToServer(updated).catch((e) => console.error("[bg-task] swallowed error:", e));
}

async function syncThreadToServer(thread: ChatThread): Promise<void> {
  const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
  const headers = await getAuthHeaders();
  // PATCH upserts by the client thread id (see packages/api/src/routes/chats.ts),
  // so the same thread always maps to one server row. No POST fallback — that
  // was creating a new chat on every message and flooding history with dupes.
  await apiFetch(`${apiUrl}/api/v1/chats/${thread.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ title: thread.title, messages: thread.messages }),
  });
}

export async function loadThreadsFromServer(): Promise<ChatThread[]> {
  try {
    const apiUrl = (import.meta as any).env?.VITE_API_URL || "";
    const headers = await getAuthHeaders();
    const res = await apiFetch(`${apiUrl}/api/v1/chats`, { headers });
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
    await apiFetch(`${apiUrl}/api/v1/chats/${threadId}`, { method: "DELETE", headers });
  } catch {}
}
