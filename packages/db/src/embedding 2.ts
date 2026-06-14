export function buildEmbeddingText(input: { objectType: string; data: Record<string, unknown>; aiSummary?: string }) {
  return [input.objectType, input.data.name, input.data.email, input.data.description, input.data.title, input.data.company, input.aiSummary]
    .filter(Boolean)
    .join(" ");
}

