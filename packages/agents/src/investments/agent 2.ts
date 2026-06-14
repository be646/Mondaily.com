export async function runInvestmentsAgent(input: { workspaceId: string; task: string }) {
  return { output: input.task, actions: [] };
}

