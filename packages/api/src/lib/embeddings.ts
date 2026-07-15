/**
 * Sovereign embeddings client. Talks to a self-hosted text-embeddings-inference (TEI) server —
 * the same "run one container on the Hetzner box" model as the SearXNG search appliance. NO third
 * party. Entirely OPT-IN: when SOVEREIGN_EMBED_URL is unset, isEmbeddingsEnabled() is false and
 * every caller falls back to the LLM-rerank search, so the product works unchanged until you flip
 * it on.
 *
 * Contract (TEI /embed): POST { inputs: string | string[] } → number[][] (one vector per input).
 * Standardize on BAAI/bge-small-en-v1.5 → 384 dims (must match the node_embeddings migration).
 */
export const EMBED_DIM = 384;

const EMBED_URL = process.env.SOVEREIGN_EMBED_URL || "";
const EMBED_TOKEN = process.env.SOVEREIGN_EMBED_TOKEN || "";

export function isEmbeddingsEnabled(): boolean {
  return EMBED_URL.length > 0;
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", ...(EMBED_TOKEN ? { Authorization: `Bearer ${EMBED_TOKEN}` } : {}) };
}

/** Embed a batch of texts. Returns one vector per input, or null on any failure (caller falls back). */
export async function embedBatch(texts: string[]): Promise<number[][] | null> {
  if (!isEmbeddingsEnabled() || texts.length === 0) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${EMBED_URL.replace(/\/$/, "")}/embed`, {
      method: "POST", headers: headers(), signal: ctrl.signal,
      body: JSON.stringify({ inputs: texts.map((t) => t.slice(0, 2000)) }),
    });
    if (!res.ok) { console.error(`[embeddings] HTTP ${res.status}`); return null; }
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    return data as number[][];
  } catch (e) {
    console.error("[embeddings] request failed:", e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function embedOne(text: string): Promise<number[] | null> {
  const out = await embedBatch([text]);
  return out?.[0] ?? null;
}
