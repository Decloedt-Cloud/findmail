import { prisma } from "@/lib/db";
import { ICP_COUNTRIES, ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { readChannelIcp } from "@/lib/icp/channel-icp";
import { logger } from "@/lib/logger";
import { activeSince, hasEnoughViews } from "@/lib/youtube/qualify";

const CANDIDATE_LIMIT = 150;

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
  const ids = parsed && typeof parsed === "object" && Array.isArray((parsed as { creatorIds?: unknown }).creatorIds)
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

export async function reuseStoredCreators(input: {
  brandIcpId: string;
  brandName: string;
  snapshot: unknown;
  searchQueries: string[];
  limit: number;
  countries?: string[];
  /** Channels already proposed for another request of this onboarding. */
  excludeCreatorIds?: string[];
}) {
  if (input.limit <= 0) return 0;
  const requested = input.countries?.length ? input.countries : null;
  const excluded = input.excludeCreatorIds?.filter(Boolean) ?? [];
  const candidates = await prisma.creator.findMany({
    where: {
      hidden: false,
      ...(excluded.length ? { id: { notIn: excluded } } : {}),
      country: { in: requested ?? ICP_COUNTRIES },
      subscriberVisibility: "PUBLIC",
      subscriberCount: { gte: ICP_MIN_SUBSCRIBERS, lte: ICP_MAX_SUBSCRIBERS },
      ...(requested
        ? {}
        : {
            lastActiveAt: { gte: activeSince() },
            averageViews: { not: null },
          }),
      OR: [
        { emails: { some: {} } },
        { instagramUrl: { not: null } },
        { twitterUrl: { not: null } },
        { tiktokUrl: { not: null } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      channelName: true,
      description: true,
      keywords: true,
      channelIcp: true,
      subscriberCount: true,
      averageViews: true,
    },
  });
  const eligible = requested
    ? candidates
    : candidates.filter((creator) => hasEnoughViews({
        subscriberCount: creator.subscriberCount,
        subscriberVisibility: "PUBLIC",
        averageViews: creator.averageViews,
      }));
  if (eligible.length === 0) return 0;

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return 0;
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
            "Match stored YouTube channels to an advertiser ICP.",
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
            channels: eligible.map((creator) => ({
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
    logger.warn("stored creator matching skipped", { status: response.status });
    return 0;
  }
  const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  const allowed = new Set(eligible.map((creator) => creator.id));
  const ids = parseCreatorIds(body.choices?.[0]?.message?.content ?? "", allowed, input.limit);
  if (ids.length === 0) return 0;
  await prisma.icpChannelMatch.createMany({
    data: ids.map((creatorId) => ({ brandIcpId: input.brandIcpId, creatorId })),
    skipDuplicates: true,
  });
  return prisma.icpChannelMatch.count({ where: { brandIcpId: input.brandIcpId } });
}
