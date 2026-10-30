import { usablePublicEmails } from "@/lib/creators/email";
import { prisma } from "@/lib/db";
import { ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";

function snapshotRequestId(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const id = (snapshot as { requestId?: unknown }).requestId;
  return typeof id === "string" ? id : "";
}

function channelIcpName(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : null;
}

async function creatorsProposedOnOtherRequests(
  rows: { id: string; snapshot: unknown }[],
  brandId: string,
  requestId: string,
) {
  if (!requestId) return new Set<string>();
  const otherIds = rows
    .filter((row) => row.id !== brandId && snapshotRequestId(row.snapshot) && snapshotRequestId(row.snapshot) !== requestId)
    .map((row) => row.id);
  if (otherIds.length === 0) return new Set<string>();
  const links = await prisma.icpChannelMatch.findMany({
    where: { brandIcpId: { in: otherIds } },
    select: { creatorId: true },
  });
  return new Set(links.map((link) => link.creatorId));
}

function maxChannels(snapshot: unknown) {
  const raw = snapshot && typeof snapshot === "object" ? Number((snapshot as { maxChannels?: unknown }).maxChannels) : NaN;
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return Math.floor(raw);
  return 10;
}

export async function listWayoIcpMatches(input: { onboardingId: string; requestId?: string; countries?: string }) {
  const rows = await prisma.brandIcp.findMany({
    where: { wayoOnboardingId: input.onboardingId },
    orderBy: { createdAt: "desc" },
  });
  const brand = input.requestId
    ? rows.find((row) => snapshotRequestId(row.snapshot) === input.requestId) ?? null
    : rows[0] ?? null;
  if (!brand) {
    return { id: null, status: "MISSING" as const, creators: [] };
  }
  const alreadyProposed = await creatorsProposedOnOtherRequests(rows, brand.id, input.requestId ?? "");
  const limit = maxChannels(brand.snapshot);
  const countries = (input.countries || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  const links = await prisma.icpChannelMatch.findMany({
    where: {
      brandIcpId: brand.id,
      creator: {
        hidden: false,
        subscriberVisibility: "PUBLIC",
        subscriberCount: { gte: ICP_MIN_SUBSCRIBERS, lte: ICP_MAX_SUBSCRIBERS },
        AND: [
          {
            OR: [
              { emails: { some: {} } },
              { instagramUrl: { not: null } },
              { twitterUrl: { not: null } },
              { tiktokUrl: { not: null } },
            ],
          },
          ...(countries.length
            ? [{
                OR: countries.map((code) => ({ country: { equals: code, mode: "insensitive" as const } })),
              }]
            : []),
        ],
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: {
      creator: {
        select: {
          id: true,
          youtubeChannelId: true,
          channelName: true,
          channelHandle: true,
          channelUrl: true,
          description: true,
          country: true,
          keywords: true,
          subscriberCount: true,
          subscriberVisibility: true,
          videoCount: true,
          viewCount: true,
          thumbnailUrl: true,
          averageViews: true,
          lastActiveAt: true,
          officialWebsiteUrl: true,
          instagramUrl: true,
          twitterUrl: true,
          tiktokUrl: true,
          matchedVideoTitle: true,
          matchedVideoUrl: true,
          matchedVideoViews: true,
          matchedVideoPublishedAt: true,
          channelIcp: true,
          emails: {
            select: {
              emailAddress: true,
              sourceType: true,
              sourceUrl: true,
              verificationStatus: true,
              isGenericInbox: true,
              confidenceStatus: true,
            },
          },
        },
      },
    },
  });
  const creators = links.flatMap((link) => {
    if (alreadyProposed.has(link.creator.id)) return [];
    const creator = link.creator;
    const emails = usablePublicEmails(creator.emails);
    const socials = {
      instagram: creator.instagramUrl,
      twitter: creator.twitterUrl,
      tiktok: creator.tiktokUrl,
      youtube: creator.channelUrl,
    };
    if (!emails.length && !socials.instagram && !socials.twitter && !socials.tiktok) return [];
    return [
      {
        id: creator.id,
        channelName: creator.channelName,
        channelHandle: creator.channelHandle,
        thumbnailUrl: creator.thumbnailUrl,
        subscriberCount: creator.subscriberCount ?? 0,
        averageViews: creator.averageViews ?? 0,
        country: creator.country,
        channelIcpName: channelIcpName(creator.channelIcp),
        email: emails[0]?.emailAddress ?? null,
        emails: emails.map((item) => item.emailAddress),
        socials,
      },
    ];
  });
  return {
    id: brand.id,
    status: brand.status,
    errorSummary: brand.errorSummary,
    queries: brand.searchQueries.filter((query) => query.trim()).slice(0, 4),
    creators,
  };
}
