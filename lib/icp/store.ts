import type { YouTubeChannel } from "@/lib/youtube/client";
import { prisma, isUniqueViolation } from "@/lib/db";
import { AVERAGE_VIEWS_METHOD } from "@/lib/youtube/metrics";

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

export async function upsertMatchedChannel(channel: YouTubeChannel, lastPublishedAt: Date | null, averageViews: number | null = null) {
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
    ...(lastPublishedAt ? {
      recentVideoPublishedAt: lastPublishedAt,
      lastActiveAt: lastPublishedAt,
    } : {}),
    ...(averageViews != null ? {
      averageViews,
      averageViewsMethod: AVERAGE_VIEWS_METHOD,
    } : {}),
    lastMetadataSyncAt: new Date(),
    discoverySource: "YOUTUBE_SEARCH" as const,
  };
  const existing = await prisma.creator.findUnique({ where: { youtubeChannelId: channel.id } });
  if (existing) {
    return prisma.creator.update({
      where: { id: existing.id },
      data: { ...shared, hidden: false },
    });
  }
  try {
    return await prisma.creator.create({
      data: { youtubeChannelId: channel.id, ...shared },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return prisma.creator.update({
      where: { youtubeChannelId: channel.id },
      data: { ...shared, hidden: false },
    });
  }
}
