import type { Prisma } from "@prisma/client";
import type { YouTubeChannel } from "@/lib/youtube/client";
import { prisma, isUniqueViolation } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rememberCreatorEmbedding } from "@/lib/icp/vector-search";
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

type ChannelCreatorFields = Omit<Prisma.CreatorUncheckedCreateInput, "youtubeChannelId">;

const CHANNEL_WRITE_ATTEMPTS = 3;

function isRecordNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2025";
}

/**
 * Write the creator row for one YouTube channel, whichever matching run gets there first.
 *
 * Two runs can reach the same channel at the same moment. Both read "no row", both try to
 * create it, and the second hits the unique key on `youtubeChannelId`. A row can also
 * vanish between the read and the update. Both cases have one answer: read again and write
 * to the row that now exists. Three attempts cover two runs; a conflict that survives them
 * is raised, and the caller skips this one channel.
 */
async function writeChannelCreator(youtubeChannelId: string, data: ChannelCreatorFields) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= CHANNEL_WRITE_ATTEMPTS; attempt += 1) {
    const existing = await prisma.creator.findUnique({
      where: { youtubeChannelId },
      select: { id: true },
    });
    if (existing) {
      try {
        const creator = await prisma.creator.update({ where: { id: existing.id }, data });
        return { creator, created: false as const };
      } catch (error) {
        if (!isUniqueViolation(error) && !isRecordNotFound(error)) throw error;
        lastError = error;
        continue;
      }
    }
    try {
      const creator = await prisma.creator.create({ data: { youtubeChannelId, ...data } });
      return { creator, created: true as const };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
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
  const { creator, created } = await writeChannelCreator(channel.id, { ...shared, hidden: false });
  await attachDescriptionContacts(creator.id, channel.description || "");
  await rememberCreatorEmbedding(creator.id).catch((error) => {
    logger.warn("channel embedding skipped", {
      message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
  });
  const refreshed = await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } });
  return created
    ? ({ creator: refreshed, created: true } as const)
    : ({ creator: refreshed, created: false } as const);
}
