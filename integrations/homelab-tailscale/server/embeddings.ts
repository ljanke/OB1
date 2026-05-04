import { EMBED_DIM, EMBED_MODEL, OLLAMA_URL } from "./config.ts";

// Ollama's /api/embed (plural) returns { embeddings: [[...]] }. Older
// /api/embeddings (singular) returns { embedding: [...] } and is deprecated;
// we use the newer endpoint for compatibility with batch use later.
export async function embed(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);
  const r = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: truncated }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Ollama embed failed: ${r.status} ${detail.slice(0, 300)}`);
  }
  const data = await r.json();
  const vec = data?.embeddings?.[0];
  if (!Array.isArray(vec)) {
    throw new Error("Ollama returned no embedding vector");
  }
  if (vec.length !== EMBED_DIM) {
    throw new Error(
      `Embedding dim mismatch: model "${EMBED_MODEL}" returned ${vec.length}, ` +
        `but EMBED_DIM is ${EMBED_DIM}. Update EMBED_DIM and the vector(N) ` +
        `column in db/init.sql to match.`,
    );
  }
  return vec;
}

// Postgres pgvector accepts a string literal like '[0.1,0.2,...]' cast to vector.
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
