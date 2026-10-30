import { readChannelIcp } from "@/lib/icp/channel-icp";
import { logger } from "@/lib/logger";

export type IcpSelectCandidate = {
  id: string;
  channelName: string;
  description: string | null;
  keywords: string[];
  channelIcp: unknown;
};

function parseCreatorIds(raw: string, allowed: Set<string>, limit: number) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const ids =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { creatorIds?: unknown }).creatorIds)
      ? (parsed as { creatorIds: unknown[] }).creatorIds
      : [];
  const kept: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !allowed.has(id) || kept.includes(id)) continue;
    kept.push(id);
    if (kept.length >= limit) break;
  }
  return kept;
}

/** Keep only channels whose audience clearly fits the advertiser ICP. */
export async function selectCreatorsForIcp(input: {
  brandName: string;
  snapshot: unknown;
  searchQueries: string[];
  candidates: IcpSelectCandidate[];
  limit: number;
}): Promise<string[]> {
  if (input.limit <= 0 || input.candidates.length === 0) return [];
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    logger.warn("icp creator select skipped", { reason: "missing-deepseek-key" });
    return [];
  }
  const response = await fetch(process.env.DEEPSEEK_API_URL?.trim() || "https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Match YouTube channels to an advertiser ICP.",
            "Select a channel only when its audience is clearly relevant to the advertiser ICP.",
            "Do not select a channel from a vague keyword overlap.",
            `Return at most ${input.limit} IDs.`,
            'Return JSON only: {"creatorIds":[]}.',
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            advertiser: {
              brandName: input.brandName,
              icp: input.snapshot,
              youtubeSearches: input.searchQueries,
            },
            channels: input.candidates.map((creator) => ({
              id: creator.id,
              name: creator.channelName,
              description: creator.description?.slice(0, 350) || null,
              keywords: creator.keywords.slice(0, 10),
              audience: readChannelIcp(creator.channelIcp),
            })),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    logger.warn("icp creator select skipped", { status: response.status });
    return [];
  }
  const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  const allowed = new Set(input.candidates.map((creator) => creator.id));
  return parseCreatorIds(body.choices?.[0]?.message?.content ?? "", allowed, input.limit);
}
