import { createHash } from "node:crypto";
import { readChannelIcp } from "@/lib/icp/channel-icp";

export const EMBED_DIMS = 768;
export const HASHED_EMBED_MODEL = "findmail-hash-v1";
export const BGE_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

export function preferredEmbedModel(): string {
  return process.env.CLOUDFLARE_ACCOUNT_ID?.trim() && process.env.CLOUDFLARE_API_TOKEN?.trim()
    ? BGE_EMBED_MODEL
    : HASHED_EMBED_MODEL;
}

export function l2Normalize(values: number[]): number[] {
  let sum = 0;
  for (const value of values) sum += value * value;
  const norm = Math.sqrt(sum);
  if (!norm) return values.map(() => 0);
  return values.map((value) => value / norm);
}

/** Deterministic bag-of-words vector. Used when Cloudflare embeddings are not configured. */
export function hashedEmbedding(text: string, dims = EMBED_DIMS): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9àâäéèêëïîôùûüç]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dims;
    const sign = digest.readUInt32BE(4) % 2 === 0 ? 1 : -1;
    vec[index] += sign;
  }
  return l2Normalize(vec);
}

export function embeddingContentHash(model: string, text: string): string {
  return createHash("sha256").update(model).update("\0").update(text).digest("hex");
}

function lineList(values: string[]): string {
  return values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean).join(", ");
}

/** The text a stored channel is embedded from. The same words rebuild the same vector. */
export function channelEmbeddingText(creator: {
  channelName: string;
  description: string | null;
  keywords: string[];
  channelIcp: unknown;
}): string {
  const icp = readChannelIcp(creator.channelIcp);
  const lines = [
    `Channel: ${creator.channelName}`,
    creator.description ? `Description: ${creator.description.replace(/\s+/g, " ").trim()}` : "",
    creator.keywords.length ? `Keywords: ${lineList(creator.keywords)}` : "",
  ];
  if (icp) {
    lines.push(
      `Audience: ${icp.name}`,
      `Audience description: ${icp.description}`,
      icp.interests.length ? `Interests: ${lineList(icp.interests)}` : "",
      icp.problems.length ? `Problems: ${lineList(icp.problems)}` : "",
      icp.goals.length ? `Goals: ${lineList(icp.goals)}` : "",
      icp.useCases.length ? `Use cases: ${lineList(icp.useCases)}` : "",
      icp.productCategories.length ? `Product categories: ${lineList(icp.productCategories)}` : "",
    );
  }
  return lines.filter(Boolean).join("\n").slice(0, 8000);
}

function parseCfVectors(payload: unknown, expected: number): number[][] | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { result?: { data?: unknown } }).result?.data;
  if (!Array.isArray(data) || !data.length) return null;
  if (typeof data[0] === "number") {
    const vec = data as number[];
    return vec.length ? [l2Normalize(vec)] : null;
  }
  const rows: number[][] = [];
  for (const row of data) {
    if (!Array.isArray(row) || !row.every((item) => typeof item === "number")) return null;
    rows.push(l2Normalize(row as number[]));
  }
  return rows.length === expected ? rows : null;
}

async function embedWithCloudflare(texts: string[]): Promise<number[][] | null> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!account || !token || !texts.length) return null;
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${BGE_EMBED_MODEL}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: texts.length === 1 ? texts[0] : texts }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) return null;
    return parseCfVectors(await response.json(), texts.length);
  } catch {
    return null;
  }
}

export async function embedTexts(texts: string[]): Promise<{ model: string; vectors: number[][] }> {
  const clean = texts.map((text) => text.replace(/\s+/g, " ").trim() || "empty");
  if (preferredEmbedModel() === BGE_EMBED_MODEL) {
    const batches: number[][] = [];
    for (let index = 0; index < clean.length; index += 16) {
      const slice = clean.slice(index, index + 16);
      const remote = await embedWithCloudflare(slice);
      if (!remote || remote.length !== slice.length) {
        return { model: HASHED_EMBED_MODEL, vectors: clean.map((text) => hashedEmbedding(text)) };
      }
      batches.push(...remote);
    }
    return { model: BGE_EMBED_MODEL, vectors: batches };
  }
  return { model: HASHED_EMBED_MODEL, vectors: clean.map((text) => hashedEmbedding(text)) };
}

export async function embedText(text: string): Promise<{ model: string; vector: number[] }> {
  const { model, vectors } = await embedTexts([text]);
  return { model, vector: vectors[0] };
}
