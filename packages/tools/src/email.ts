export async function draftEmail(input: Record<string, unknown>) {
  return { ok: true, draft: input };
}

export async function getEmailThreads(nodeId: string, limit = 5) {
  return { nodeId, limit, threads: [] };
}

