import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ICP_COUNTRIES, ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { selectCreatorsForIcp } from "@/lib/icp/select-creators";
import { activeSince, hasEnoughViews } from "@/lib/youtube/qualify";

const CANDIDATE_LIMIT = 150;

const USABLE_CONTACT: Prisma.CreatorWhereInput = {
  OR: [
    { emails: { some: { verificationStatus: { notIn: ["INVALID", "NOT_FOUND"] } } } },
    { AND: [{ instagramUrl: { not: null } }, { NOT: { instagramUrl: "" } }] },
    { AND: [{ twitterUrl: { not: null } }, { NOT: { twitterUrl: "" } }] },
    { AND: [{ tiktokUrl: { not: null } }, { NOT: { tiktokUrl: "" } }] },
  ],
};

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
