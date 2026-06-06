export async function orchestrate(input: { workspaceId: string; task: string }) {
  return { agent: "ask-mondaily", input };
}

