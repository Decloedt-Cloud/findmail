import { pickPrimaryEmail } from "@/lib/creators/email";
import { prisma } from "@/lib/db";

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

function maxChannels(snapshot: unknown) {
  const raw = snapshot && typeof snapshot === "object" ? Number((snapshot as { maxChannels?: unknown }).maxChannels) : NaN;
  if (Number.isFinite(raw) && raw >= 1 && raw <= 30) return Math.floor(raw);
  return 10;
}

export async function listWayoIcpMatches(input: { onboardingId: string; requestId?: string }) {
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
  const limit = maxChannels(brand.snapshot);
  const links = await prisma.icpChannelMatch.findMany({
    where: { brandIcpId: brand.id },
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
    const creator = link.creator;
    const email = pickPrimaryEmail(creator.emails);
    const socials = {
      instagram: creator.instagramUrl,
      twitter: creator.twitterUrl,
      tiktok: creator.tiktokUrl,
      youtube: creator.channelUrl,
    };
    if (!email && !socials.instagram && !socials.twitter && !socials.tiktok) return [];
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
        email: email?.emailAddress ?? null,
        socials,
      },
    ];
  });
  return {
    id: brand.id,
    status: brand.status,
    errorSummary: brand.errorSummary,
    creators,
  };
}
