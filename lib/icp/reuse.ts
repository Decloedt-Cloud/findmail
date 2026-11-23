import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { USABLE_CONTACT } from "@/lib/creators/contact";
import { ICP_COUNTRIES, ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { selectCreatorsForIcp } from "@/lib/icp/select-creators";
import { embedText } from "@/lib/icp/embed";
import { nearestStoredCreatorIds } from "@/lib/icp/vector-search";
import { activeSince, hasEnoughViews } from "@/lib/youtube/qualify";

/** How many on-topic channels one DeepSeek call can read. The catalog itself is not cut to this size. */
const MODEL_CANDIDATE_LIMIT = 40;

/** A requested language keeps a channel that publishes in it, in a regional variant (`en` covers `en-GB`), or whose language was never stored. */
export function languageReuseFilter(codes: string[]): Prisma.CreatorWhereInput | null {
  const languages = codes
    .map((code) => code.trim().toLowerCase())
    .filter((code, index, list) => code.length > 0 && list.indexOf(code) === index);
  if (languages.length === 0) return null;
  return {
    OR: [
      { language: null },
      { language: "" },
      ...languages.flatMap((code) => [
        { language: { equals: code, mode: "insensitive" as const } },
        { language: { startsWith: `${code}-`, mode: "insensitive" as const } },
      ]),
    ],
  };
}

/**
 * The model choice is the whole list.
 *
 * An empty choice used to keep the most recently stored channels. Those channels
 * belong to whichever site was matched last, so the next site received the same
 * off-theme list. No choice means this catalog has nothing for this site.
 */
export function catalogCreatorIds(selected: string[], _eligibleIds: string[], limit: number) {
  if (limit <= 0 || selected.length === 0) return [];
  return selected.slice(0, limit);
}

const GENERIC_TOPIC = new Set([
  "video", "videos", "youtube", "channel", "channels", "content", "creator", "creators",
  "subscribe", "audience", "people", "online", "business", "marketing", "digital", "social",
  "media", "brand", "brands", "review", "reviews", "lifestyle", "community", "world",
  "tips", "guide", "watch", "watching", "about", "their", "they", "have", "more", "best",
  "with", "from", "this", "that", "your", "pour", "avec", "dans", "cette", "vous",
  "the", "and", "for", "des", "les", "une", "qui", "que", "est", "par", "sur", "aux",
]);

/** Distinctive words of a topic. Shared glue ("video", "the", "pour") does not count. */
export function topicTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9àâäéèêëïîôùûüç]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && !GENERIC_TOPIC.has(word));
}

/**
 * A stored channel may be offered again only when its audience shares this site's
 * topic. One long distinctive word, or two shorter ones. Otherwise the catalog is
 * a list of whoever was saved last.
 */
export function sharesAdvertiserTopic(advertiser: string, channel: string): boolean {
  const wanted = new Set(topicTokens(advertiser));
  if (wanted.size === 0) return false;
  let hits = 0;
  for (const word of topicTokens(channel)) {
    if (!wanted.has(word)) continue;
    if (word.length >= 7) return true;
    hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

/** Higher when more distinctive words of the site appear on the channel. A long word counts double. */
export function topicOverlapScore(advertiser: string, channel: string): number {
  const wanted = new Set(topicTokens(advertiser));
  if (wanted.size === 0) return 0;
  const seen = new Set<string>();
  let score = 0;
  for (const word of topicTokens(channel)) {
    if (!wanted.has(word) || seen.has(word)) continue;
    seen.add(word);
    score += word.length >= 7 ? 2 : 1;
  }
  return score;
}

/** On-topic channels, strongest overlap first, cut to what one model call can read. */
export function rankChannelsForModel<T>(
  advertiser: string,
  channels: T[],
  topicOf: (channel: T) => string,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  return channels
    .filter((channel) => sharesAdvertiserTopic(advertiser, topicOf(channel)))
    .map((channel) => ({ channel, score: topicOverlapScore(advertiser, topicOf(channel)) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((row) => row.channel);
}

function textOf(value: unknown, out: string[], depth = 0) {
  if (depth > 5 || out.length > 40) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (text) out.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) textOf(item, out, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) textOf(child, out, depth + 1);
}

/** The site's topic, from the ICP snapshot and the searches written for it. */
export function advertiserTopicText(snapshot: unknown, searchQueries: string[]): string {
  const parts: string[] = [];
  if (snapshot && typeof snapshot === "object") {
    const record = snapshot as {
      matchingText?: unknown;
      icps?: unknown;
      offers?: unknown;
      request?: unknown;
    };
    textOf(record.matchingText, parts);
    textOf(record.icps, parts);
    textOf(record.offers, parts);
    textOf(record.request, parts);
  }
  textOf(searchQueries, parts);
  return parts.join(" ");
}

function channelTopicText(creator: {
  channelName: string;
  description: string | null;
  keywords: string[];
  channelIcp: unknown;
}): string {
  const icp: string[] = [];
  textOf(creator.channelIcp, icp);
  return [creator.channelName, creator.description, creator.keywords.join(" "), icp.join(" ")].filter(Boolean).join(" ");
}

export async function reuseStoredCreators(input: {
  brandIcpId: string;
  brandName: string;
  snapshot: unknown;
  searchQueries: string[];
  limit: number;
  countries?: string[];
  /** ISO 639-1 codes. A chosen list keeps channels in one of them, a regional variant, or with no stored language. */
  languages?: string[];
  /** ISO 639-1. A chosen language keeps channels in it, a regional variant, or with no stored language. */
  language?: string | null;
  /** Channels already proposed for another request of this onboarding. */
  excludeCreatorIds?: string[];
}): Promise<{ eligible: number; linked: number }> {
  if (input.limit <= 0) return { eligible: 0, linked: 0 };
  const requested = input.countries?.length ? input.countries : null;
  const excluded = input.excludeCreatorIds?.filter(Boolean) ?? [];
  const languageList = [...(input.languages ?? []), ...(input.language ? [input.language] : [])];
  const language = languageReuseFilter(languageList);
  const creatorSelect = {
    id: true,
    channelName: true,
    description: true,
    keywords: true,
    channelIcp: true,
    subscriberCount: true,
    averageViews: true,
  } as const;
  const onTopic = advertiserTopicText(input.snapshot, input.searchQueries);
  let mode: "vector" | "scan" = "scan";
  let candidates: Array<{
    id: string;
    channelName: string;
    description: string | null;
    keywords: string[];
    channelIcp: unknown;
    subscriberCount: number | null;
    averageViews: number | null;
  }> = [];
  if (onTopic.trim()) {
    try {
      const embedded = await embedText(onTopic);
      const nearest = await nearestStoredCreatorIds({
        vector: embedded.vector,
        model: embedded.model,
        countries: requested ?? ICP_COUNTRIES,
        languages: languageList,
        excludeCreatorIds: excluded,
        requireRecentActivity: !requested,
      });
      if (nearest.status === "hits") {
        mode = "vector";
        const rows = await prisma.creator.findMany({
          where: { id: { in: nearest.ids } },
          select: creatorSelect,
        });
        const order = new Map(nearest.ids.map((id, index) => [id, index]));
        candidates = rows.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
      } else if (nearest.status === "none") {
        mode = "vector";
      }
    } catch (error) {
      logger.warn("icp vector search unavailable", {
        message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      });
    }
  }
  if (mode === "scan") {
    candidates = await prisma.creator.findMany({
      where: {
        hidden: false,
        ...(excluded.length ? { id: { notIn: excluded } } : {}),
        country: { in: requested ?? ICP_COUNTRIES },
        ...(language ?? {}),
        subscriberVisibility: "PUBLIC",
        subscriberCount: { gte: ICP_MIN_SUBSCRIBERS, lte: ICP_MAX_SUBSCRIBERS },
        channelIcp: { not: Prisma.DbNull },
        ...(requested
          ? {}
          : {
              lastActiveAt: { gte: activeSince() },
              averageViews: { not: null },
            }),
        AND: [USABLE_CONTACT],
      },
      select: creatorSelect,
    });
  }
  const passingViews = requested
    ? candidates
    : candidates.filter((creator) =>
        hasEnoughViews({
          subscriberCount: creator.subscriberCount,
          subscriberVisibility: "PUBLIC",
          averageViews: creator.averageViews,
        }),
      );
  const matched = mode === "vector"
    ? passingViews
    : passingViews.filter((creator) => sharesAdvertiserTopic(onTopic, channelTopicText(creator)));
  const ranked = mode === "vector"
    ? matched.slice(0, MODEL_CANDIDATE_LIMIT)
    : rankChannelsForModel(onTopic, matched, channelTopicText, MODEL_CANDIDATE_LIMIT);
  if (ranked.length === 0) {
    logger.info("icp catalog reuse", {
      brandIcpId: input.brandIcpId,
      mode,
      pool: candidates.length,
      eligible: matched.length,
      sent: 0,
      selected: 0,
      linked: 0,
    });
    return { eligible: matched.length, linked: 0 };
  }

  const selected = await selectCreatorsForIcp({
    brandName: input.brandName,
    snapshot: input.snapshot,
    searchQueries: input.searchQueries,
    candidates: ranked,
    limit: input.limit,
  });
  const ids = catalogCreatorIds(selected, ranked.map((creator) => creator.id), input.limit);
  if (ids.length === 0) {
    logger.info("icp catalog reuse", {
      brandIcpId: input.brandIcpId,
      mode,
      pool: candidates.length,
      eligible: matched.length,
      sent: ranked.length,
      selected: 0,
      linked: 0,
    });
    return { eligible: matched.length, linked: 0 };
  }
  await prisma.icpChannelMatch.createMany({
    data: ids.map((creatorId) => ({ brandIcpId: input.brandIcpId, creatorId })),
    skipDuplicates: true,
  });
  const linked = await prisma.icpChannelMatch.count({ where: { brandIcpId: input.brandIcpId } });
  logger.info("icp catalog reuse", {
    brandIcpId: input.brandIcpId,
    mode,
    pool: candidates.length,
    eligible: matched.length,
    sent: ranked.length,
    selected: selected.length,
    linked,
  });
  return { eligible: matched.length, linked };
}
