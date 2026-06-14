export async function runHrAgent(input: { workspaceId: string; task: string }) {
  return { output: input.task, actions: [] };
}

