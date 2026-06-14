export async function runSalesAgent(input: { workspaceId: string; task: string; nodeIds?: string[]; context?: Record<string, unknown> }) {
  return { output: `Sales agent scaffold received: ${input.task}`, actions: [] };
}

