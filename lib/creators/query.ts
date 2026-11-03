import type { EmailVerificationStatus, Prisma } from "@prisma/client";
import { readChannelIcp } from "@/lib/icp/channel-icp";
import { icpHost, icpIdentityKey, uniqueIcpsByName } from "@/lib/icp/identity";
import { prisma } from "@/lib/db";
import { pickPrimaryEmail } from "@/lib/creators/email";
import { matchesSearchCountry } from "@/lib/youtube/client";
import { topicTier } from "@/lib/youtube/discovery";

export const creatorInclude = {
  emails: { orderBy: { discoveredAt: "desc" as const } },
  icpChannels: {
    select: { brandIcp: { select: { id: true, brandName: true } } },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.CreatorInclude;

export type CreatorFilters = {
  q?: string;
  country?: string;
  brandIcpId?: string;
  brandIcpIds?: string[];
  emailStatus?: string;
  minSubscribers?: number;
  maxSubscribers?: number;
  hasEmail?: "true" | "false";
  listId?: string;
  ids?: string[];
  jobId?: string;
  includeHidden?: boolean;
};

export function creatorWhere(filters: CreatorFilters): Prisma.CreatorWhereInput {
  const where: Prisma.CreatorWhereInput = {};
  if (!filters.includeHidden) where.hidden = false;
  if (filters.q) {
    where.OR = [
      { channelName: { contains: filters.q, mode: "insensitive" } },
      { youtubeChannelId: { equals: filters.q } },
      { channelHandle: { contains: filters.q, mode: "insensitive" } },
      { emails: { some: { normalizedEmail: { contains: filters.q.toLowerCase() } } } },
    ];
  }
  if (filters.country) where.country = filters.country.toUpperCase();
  if (filters.brandIcpIds?.length) where.icpChannels = { some: { brandIcpId: { in: filters.brandIcpIds } } };
  else if (filters.brandIcpId) where.icpChannels = { some: { brandIcpId: filters.brandIcpId } };
  if (filters.minSubscribers != null || filters.maxSubscribers != null) {
    where.subscriberCount = {
      ...(filters.minSubscribers != null ? { gte: filters.minSubscribers } : {}),
      ...(filters.maxSubscribers != null ? { lte: filters.maxSubscribers } : {}),
    };
    where.subscriberVisibility = "PUBLIC";
  }
  if (filters.listId) where.listMembers = { some: { listId: filters.listId } };
  if (filters.ids) where.id = { in: filters.ids };
  if (filters.jobId) where.jobItems = { some: { jobId: filters.jobId } };

  if (filters.emailStatus === "NOT_FOUND") {
    where.emailSearchStatus = "NOT_FOUND";
  } else if (filters.emailStatus) {
    where.emails = { some: { verificationStatus: filters.emailStatus as EmailVerificationStatus } };
  } else if (filters.hasEmail === "true") {
    where.emails = { some: {} };
  } else if (filters.hasEmail === "false") {
    where.emails = { none: {} };
  }
  return where;
}

export function creatorOrder(sort: string, direction: "asc" | "desc"): Prisma.CreatorOrderByWithRelationInput | Prisma.CreatorOrderByWithRelationInput[] {
  if (sort === "subscribers") return { subscriberCount: { sort: direction, nulls: "last" } };
  if (sort === "averageViews") return { averageViews: { sort: direction, nulls: "last" } };
  if (sort === "lastActiveAt") return { lastActiveAt: { sort: direction, nulls: "last" } };
  if (sort === "channelName") return { channelName: direction };
  if (sort === "relevance") return [{ relevanceScore: direction }, { discoveredAt: "desc" }];
  return { discoveredAt: direction };
}

export function serializeCreator<
  T extends {
    viewCount: bigint | null;
    emails: Parameters<typeof pickPrimaryEmail>[0];
    icpChannels?: { brandIcp: { id: string; brandName: string } }[];
  },
>(creator: T) {
  const { icpChannels, ...rest } = creator;
  return {
    ...rest,
    channelIcp: readChannelIcp("channelIcp" in creator ? creator.channelIcp : null),
    viewCount: creator.viewCount?.toString() ?? null,
    primaryEmail: pickPrimaryEmail(creator.emails),
    icps: uniqueIcpsByName((icpChannels ?? []).map((link) => link.brandIcp)),
  };
}

export function creatorMatchesTopic(creator: { channelName: string; channelHandle: string | null; description: string | null }, keywords: string[]) {
  if (keywords.length === 0) return true;
  return topicTier({
    title: creator.channelName,
    handle: creator.channelHandle,
    description: creator.description,
    videoTitle: null,
    keywords,
  }) === "strong";
}

/** Every stored copy of the selected brand, so a repeated ICP still filters as one. */
export async function resolveBrandIcpIds(brandIcpId: string) {
  const selected = await prisma.brandIcp.findUnique({
    where: { id: brandIcpId },
    select: { brandName: true, websiteUrl: true },
  });
  if (!selected) return [brandIcpId];
  const key = icpIdentityKey(selected.brandName, selected.websiteUrl);
  const host = icpHost(selected.websiteUrl);
  const rows = await prisma.brandIcp.findMany({
    where: {
      brandName: { equals: selected.brandName, mode: "insensitive" },
      ...(host ? { websiteUrl: { contains: host, mode: "insensitive" } } : {}),
    },
    select: { id: true, brandName: true, websiteUrl: true },
  });
  const ids = rows.filter((row) => icpIdentityKey(row.brandName, row.websiteUrl) === key).map((row) => row.id);
  return ids.length ? ids : [brandIcpId];
}

export async function listCreators(filters: CreatorFilters, page: number, pageSize: number, sort: string, direction: "asc" | "desc") {
  const brandIcpIds = filters.brandIcpId ? await resolveBrandIcpIds(filters.brandIcpId) : undefined;
  const where = creatorWhere({ ...filters, brandIcpIds });
  if (filters.jobId) {
    const search = await prisma.searchJob.findFirst({
      where: { processingJobId: filters.jobId },
      select: { keywords: true, countries: true },
    });
    const keywords = search?.keywords ?? [];
    const countries = search?.countries ?? [];
    const rows = await prisma.creator.findMany({
      where,
      include: creatorInclude,
      orderBy: creatorOrder(sort, direction),
    });
    const matched = rows.filter((creator) => creatorMatchesTopic(creator, keywords) && matchesSearchCountry(creator, countries));
    const start = (page - 1) * pageSize;
    return { total: matched.length, creators: matched.slice(start, start + pageSize).map(serializeCreator), page, pageSize };
  }
  const [total, rows] = await prisma.$transaction([
    prisma.creator.count({ where }),
    prisma.creator.findMany({
      where,
      include: creatorInclude,
      orderBy: creatorOrder(sort, direction),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return { total, creators: rows.map(serializeCreator), page, pageSize };
}
