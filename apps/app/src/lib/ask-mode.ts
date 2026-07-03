/**
 * Page-aware Ask mode — a LABEL for the context the Ask engine already receives on each page. This
 * is pure UI framing: it does not change routing, agents, or what Ask sends. The same one Ask
 * engine simply names the scope it's operating in so the user knows what the answer is grounded in.
 */
export interface AskMode { label: string; hint: string }

export function askModeForPath(pathname: string): AskMode {
  const p = (pathname || "").toLowerCase();
  if (p.startsWith("/discovery")) return { label: "Discovery mode", hint: "Grounded in your Discovery leads & search results." };
  if (p.startsWith("/decisions")) return { label: "Decision mode", hint: "Grounded in the Decision Queue." };
  if (p.startsWith("/finance") || p.startsWith("/invoices") || p.startsWith("/quotes")) return { label: "Finance mode", hint: "Grounded in invoices, quotes & finance data." };
  if (p.startsWith("/tasks")) return { label: "Operations mode", hint: "Grounded in your tasks & workload." };
  if (p.startsWith("/objects") || p.startsWith("/records") || p.startsWith("/lists") || p.startsWith("/graph") || p.startsWith("/search")) return { label: "Graph mode", hint: "Grounded in your records, lists & the workspace graph." };
  return { label: "Workspace mode", hint: "General workspace context." };
}
