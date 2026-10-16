import type { DiscoverySource, Prisma } from "@prisma/client";
import { prisma, isUniqueViolation } from "@/lib/db";
import { provenanceNote } from "@/lib/creators/email";
import type { EmailCandidate } from "@/lib/email/discovery";
import type { DiscoveredChannel } from "@/lib/youtube/discovery";

function channelUrl(id: string, customUrl: string | null) {
  if (customUrl) {
    const handle = customUrl.startsWith("@") ? customUrl : `@${customUrl}`;
    return `https://www.youtube.com/${handle}`;
  }
  return `https://www.youtube.com/channel/${id}`;
}

function viewCount(value: string | null) {
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function dateOrNull(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function saveDiscoveredChannel(
  channel: DiscoveredChannel,
  meta: { niche?: string | null; source?: DiscoverySource },
) {
  const data = {
    channelName: channel.title || channel.id,
    channelHandle: channel.customUrl,
    channelUrl: channelUrl(channel.id, channel.customUrl),
    description: channel.description,
    country: channel.country,
    discoveryRegion: channel.discoveryRegion,
    language: channel.defaultLanguage,
    subscriberCount: channel.subscriberCount,
    subscriberVisibility: channel.subscriberVisibility,
    videoCount: channel.videoCount,
    viewCount: viewCount(channel.viewCount),
    thumbnailUrl: channel.thumbnailUrl,
    keywords: channel.keywords,
    recentVideoPublishedAt: dateOrNull(channel.recentVideoPublishedAt),
    lastActiveAt: dateOrNull(channel.lastActiveAt),
    averageViews: channel.averageViews,
    averageViewsMethod: channel.averageViewsMethod,
    instagramUrl: channel.instagramUrl,
    twitterUrl: channel.twitterUrl,
    tiktokUrl: channel.tiktokUrl,
    matchedVideoTitle: channel.matchedVideo.title,
    matchedVideoUrl: channel.matchedVideo.url,
    matchedVideoViews: channel.matchedVideo.views,
    matchedVideoPublishedAt: dateOrNull(channel.matchedVideo.publishedAt),
    relevanceScore: channel.relevanceScore,
    lastMetadataSyncAt: new Date(),
    niche: meta.niche ?? null,
    discoverySource: meta.source ?? "YOUTUBE_SEARCH",
  } satisfies Prisma.CreatorUpdateInput;

  const website =
    channel.officialWebsiteUrl != null
      ? {
          officialWebsiteUrl: channel.officialWebsiteUrl,
          websiteStatus: "FOUND" as const,
          websiteEvidence: channel.websiteEvidence,
        }
      : {
          officialWebsiteUrl: null,
          websiteStatus: "UNAVAILABLE" as const,
          websiteEvidence: channel.websiteEvidence,
        };
  const emailStatus =
    channel.descriptionEmails.length === 0
      ? null
      : channel.descriptionEmails.some((email) => email.verificationStatus === "NEEDS_REVIEW")
        ? ("NEEDS_REVIEW" as const)
        : ("FOUND" as const);

  const existing = await prisma.creator.findUnique({ where: { youtubeChannelId: channel.id } });
  if (existing) {
    await prisma.dedupEvent.create({ data: { kind: "channel", key: channel.id, source: "youtube-discovery" } });
    const creator = await prisma.creator.update({
      where: { id: existing.id },
      data: {
        ...data,
        ...(channel.officialWebsiteUrl ? website : {}),
        ...(emailStatus ? { emailSearchStatus: emailStatus } : {}),
        niche: existing.niche ?? meta.niche ?? null,
        hidden: false,
      },
    });
    await persistDescriptionEmails(creator.id, channel.descriptionEmails);
    return { creator, duplicate: true };
  }

  try {
    const creator = await prisma.creator.create({
      data: {
        youtubeChannelId: channel.id,
        ...data,
        ...website,
        ...(emailStatus ? { emailSearchStatus: emailStatus } : {}),
        niche: meta.niche ?? null,
        discoveredAt: new Date(),
      },
    });
    await persistDescriptionEmails(creator.id, channel.descriptionEmails);
    return { creator, duplicate: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await prisma.dedupEvent.create({ data: { kind: "channel", key: channel.id, source: "youtube-discovery" } });
    const creator = await prisma.creator.update({
      where: { youtubeChannelId: channel.id },
      data: {
        ...data,
        ...(channel.officialWebsiteUrl ? website : {}),
        ...(emailStatus ? { emailSearchStatus: emailStatus } : {}),
        hidden: false,
      },
    });
    await persistDescriptionEmails(creator.id, channel.descriptionEmails);
    return { creator, duplicate: true };
  }
}

async function persistDescriptionEmails(creatorId: string, emails: EmailCandidate[]) {
  for (const candidate of emails) {
    await saveEmailCandidate(creatorId, candidate);
  }
}

export async function saveEmailCandidate(creatorId: string, candidate: EmailCandidate) {
  const existing = await prisma.emailContact.findUnique({
    where: { creatorId_normalizedEmail: { creatorId, normalizedEmail: candidate.normalizedEmail } },
  });
  if (existing) {
    await prisma.dedupEvent.create({
      data: { kind: "email", key: `${creatorId}:${candidate.normalizedEmail}`, source: candidate.sourceType },
    });
    return { email: existing, duplicate: true };
  }
  try {
    const email = await prisma.emailContact.create({
      data: {
        creatorId,
        emailAddress: candidate.emailAddress,
        normalizedEmail: candidate.normalizedEmail,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        extractionMethod: candidate.extractionMethod,
        confidenceStatus: candidate.confidenceStatus,
        verificationStatus: candidate.verificationStatus,
        isOnOfficialDomain: candidate.isOnOfficialDomain,
        isGenericInbox: candidate.isGenericInbox,
        pageTitle: candidate.pageTitle,
        provenanceNote: provenanceNote(candidate.sourceType),
      },
    });
    return { email, duplicate: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const email = await prisma.emailContact.findUniqueOrThrow({
      where: { creatorId_normalizedEmail: { creatorId, normalizedEmail: candidate.normalizedEmail } },
    });
    await prisma.dedupEvent.create({
      data: { kind: "email", key: `${creatorId}:${candidate.normalizedEmail}`, source: candidate.sourceType },
    });
    return { email, duplicate: true };
  }
}
