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
  return { id: Date.now().toString(), title: firstMessage.slice(0, 45), messages: [], updatedAt: Date.now() };
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
}
