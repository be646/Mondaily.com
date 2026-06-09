export interface ChatMessage { role: "user" | "assistant"; content: string; }
export interface ChatThread { id: string; title: string; messages: ChatMessage[]; updatedAt: number; }

const KEY = "mondaily_chat_threads";

export function getThreads(): ChatThread[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function saveThreads(threads: ChatThread[]) {
  try { localStorage.setItem(KEY, JSON.stringify(threads)); } catch {}
}

export function createThread(firstMessage: string): ChatThread {
  return { id: Date.now().toString(), title: firstMessage.slice(0, 45), messages: [], updatedAt: Date.now() };
}

export function addMessageToThread(threadId: string, message: ChatMessage): ChatThread[] {
  const threads = getThreads();
  const idx = threads.findIndex(t => t.id === threadId);
  if (idx === -1) return threads;
  const updated = { ...threads[idx], messages: [...threads[idx].messages, message], updatedAt: Date.now() };
  const newThreads = [updated, ...threads.filter(t => t.id !== threadId)];
  saveThreads(newThreads);
  return newThreads;
}

export async function sendAndSave(threadId: string | null, message: string, onReply: (reply: string) => void): Promise<string> {
  const token = localStorage.getItem("mondaily_session_token");
  const workspaceId = localStorage.getItem("mondaily_workspace_id");
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const res = await fetch(`${apiUrl}/api/v1/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {})
    },
    body: JSON.stringify({ message })
  });
  const data = await res.json() as any;
  const reply = data.reply || "No response.";
  onReply(reply);
  return reply;
}
