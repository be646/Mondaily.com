export async function runFinanceAgent(input: { workspaceId: string; task: string }) {
  return { output: input.task, actions: [] };
}

