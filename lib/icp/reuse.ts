import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { USABLE_CONTACT } from "@/lib/creators/contact";
import { ICP_COUNTRIES, ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { selectCreatorsForIcp } from "@/lib/icp/select-creators";
import { activeSince, hasEnoughViews } from "@/lib/youtube/qualify";

const CANDIDATE_LIMIT = 150;

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
}) {
  if (input.limit <= 0) return 0;
  const requested = input.countries?.length ? input.countries : null;
  const excluded = input.excludeCreatorIds?.filter(Boolean) ?? [];
  const language = languageReuseFilter([...(input.languages ?? []), ...(input.language ? [input.language] : [])]);
  const candidates = await prisma.creator.findMany({
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
    : candidates.filter((creator) =>
        hasEnoughViews({
          subscriberCount: creator.subscriberCount,
          subscriberVisibility: "PUBLIC",
          averageViews: creator.averageViews,
        }),
      );
  if (eligible.length === 0) return 0;

  const ids = await selectCreatorsForIcp({
    brandName: input.brandName,
    snapshot: input.snapshot,
    searchQueries: input.searchQueries,
    candidates: eligible,
    limit: input.limit,
  });
  if (ids.length === 0) return 0;
  await prisma.icpChannelMatch.createMany({
    data: ids.map((creatorId) => ({ brandIcpId: input.brandIcpId, creatorId })),
    skipDuplicates: true,
  });
  return prisma.icpChannelMatch.count({ where: { brandIcpId: input.brandIcpId } });
}
