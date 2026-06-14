export async function enrichPerson(nodeId: string, email: string, workspaceId: string) {
  return { nodeId, email, workspaceId, enriched: false };
}

