const DIMS = 512;

export function embeddingConfigured(): boolean {
  return Boolean(process.env.EMBEDDING_API_KEY?.trim());
}

/** OpenAI-compatible embeddings. One vector per input, same order. */
export async function embedTexts(inputs: string[]): Promise<number[][] | null> {
  const key = process.env.EMBEDDING_API_KEY?.trim();
  if (!key || inputs.length === 0) return null;
  const url = process.env.EMBEDDING_API_URL?.trim() || "https://api.openai.com/v1/embeddings";
  const model = process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: inputs, dimensions: DIMS }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Embedding request failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== inputs.length) return null;
  const vectors = rows.map((row) => row.embedding ?? []);
  if (vectors.some((vector) => vector.length !== DIMS)) return null;
  return vectors;
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
