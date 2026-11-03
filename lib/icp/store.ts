import type { YouTubeChannel } from "@/lib/youtube/client";
import { prisma, isUniqueViolation } from "@/lib/db";
import { AVERAGE_VIEWS_METHOD } from "@/lib/youtube/metrics";
import { extractPublicContacts } from "@/lib/youtube/contacts";

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

/** Persist IG / X / TikTok / website / emails written in the public About text. */
async function attachDescriptionContacts(creatorId: string, description: string) {
  const found = extractPublicContacts([description]);
  const current = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      officialWebsiteUrl: true,
      instagramUrl: true,
      twitterUrl: true,
      tiktokUrl: true,
      emailSearchStatus: true,
    },
  });
  if (!current) return;

  const hasSocial = Boolean(found.instagram || found.twitter || found.tiktok);
  const hasWebsite = Boolean(found.website);
  const hasEmails = found.emails.length > 0;
  if (!hasSocial && !hasWebsite && !hasEmails) return;

  await prisma.creator.update({
    where: { id: creatorId },
    data: {
      ...(found.website && !current.officialWebsiteUrl
        ? {
            officialWebsiteUrl: found.website,
            websiteStatus: "FOUND" as const,
            websiteEvidence: found.websiteEvidence,
          }
        : {}),
      ...(found.instagram && !current.instagramUrl ? { instagramUrl: found.instagram } : {}),
      ...(found.twitter && !current.twitterUrl ? { twitterUrl: found.twitter } : {}),
      ...(found.tiktok && !current.tiktokUrl ? { tiktokUrl: found.tiktok } : {}),
      // Leave NOT_SEARCHED when only socials/website so the ICP crawl can still run.
      ...(hasEmails && current.emailSearchStatus === "NOT_SEARCHED"
        ? {
            emailSearchStatus: found.emails.some((email) => email.verificationStatus === "NEEDS_REVIEW")
              ? ("NEEDS_REVIEW" as const)
              : ("FOUND" as const),
          }
        : {}),
    },
  });

  for (const candidate of found.emails) {
    const existing = await prisma.emailContact.findUnique({
      where: {
        creatorId_normalizedEmail: { creatorId, normalizedEmail: candidate.normalizedEmail },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.emailContact.create({
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
        provenanceNote: "Public email written in the YouTube channel description.",
      },
    });
  }
}

export async function upsertMatchedChannel(
  channel: YouTubeChannel,
  lastPublishedAt: Date | null,
  averageViews: number | null = null,
) {
  const shared = {
    channelName: channel.title || channel.id,
    channelHandle: channel.customUrl,
    channelUrl: channelUrl(channel.id, channel.customUrl),
    description: channel.description,
    country: channel.country,
    language: channel.defaultLanguage,
    subscriberCount: channel.subscriberCount,
    subscriberVisibility: channel.subscriberVisibility,
    videoCount: channel.videoCount,
    viewCount: viewCount(channel.viewCount),
    thumbnailUrl: channel.thumbnailUrl,
    keywords: channel.keywords,
    ...(lastPublishedAt
      ? {
          recentVideoPublishedAt: lastPublishedAt,
          lastActiveAt: lastPublishedAt,
        }
      : {}),
    ...(averageViews != null
      ? {
          averageViews,
          averageViewsMethod: AVERAGE_VIEWS_METHOD,
        }
      : {}),
    lastMetadataSyncAt: new Date(),
    discoverySource: "YOUTUBE_SEARCH" as const,
  };
  const existing = await prisma.creator.findUnique({ where: { youtubeChannelId: channel.id } });
  let creator;
  let created = false as boolean;
  if (existing) {
    creator = await prisma.creator.update({
      where: { id: existing.id },
      data: { ...shared, hidden: false },
    });
  } else {
    try {
      creator = await prisma.creator.create({
        data: { youtubeChannelId: channel.id, ...shared },
      });
      created = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      creator = await prisma.creator.update({
        where: { youtubeChannelId: channel.id },
        data: { ...shared, hidden: false },
      });
    }
  }
  await attachDescriptionContacts(creator.id, channel.description || "");
  const refreshed = await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } });
  return created
    ? ({ creator: refreshed, created: true } as const)
    : ({ creator: refreshed, created: false } as const);
}
