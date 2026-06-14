export async function runRealEstateAgent(input: { workspaceId: string; task: string }) {
  return { output: input.task, actions: [] };
}

