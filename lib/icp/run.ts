import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ICP_COUNTRIES,
  ICP_MAX_SUBSCRIBERS,
  ICP_MIN_SUBSCRIBERS,
  icpSearchPlan,
  matchesIcpAudience,
} from "@/lib/icp/audience";
import { writeChannelIcp } from "@/lib/icp/channel-icp";
import { discoverPublicEmail } from "@/lib/icp/public-email";
import { UnrecoverableError } from "bullmq";
import { searchQueriesForIcp } from "@/lib/icp/deepseek";
import { reuseStoredCreators } from "@/lib/icp/reuse";
import { upsertMatchedChannel } from "@/lib/icp/store";
import { YouTubeApiError, YouTubeClient, createYouTubeClient, type YouTubeChannel, type YouTubeVideoDetails } from "@/lib/youtube/client";
import { selectRecentPublicVideos } from "@/lib/youtube/metrics";

export async function runMatchIcpChannels(processingJobId: string) {
  const brand = await prisma.brandIcp.findUnique({ where: { processingJobId } });
  if (!brand) throw new Error("ICP match is missing its saved profile.");
  if (brand.status === "COMPLETED" && brand.matchedChannelCount > 0) return;

  await prisma.brandIcp.update({
    where: { id: brand.id },
    data: { status: "RUNNING", errorSummary: null },
  });
  await prisma.processingJob.update({
    where: { id: processingJobId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 10 },
  });

  try {
    const analyzed = await searchQueriesForIcp({
      brandName: brand.brandName,
      websiteUrl: brand.websiteUrl,
      snapshot: brand.snapshot,
    });
    await prisma.brandIcp.update({
      where: { id: brand.id },
      data: { searchQueries: analyzed.queries, analysisNote: analyzed.note || null },
    });

    const reused = await reuseStoredCreators({
      brandIcpId: brand.id,
      brandName: brand.brandName,
      snapshot: brand.snapshot,
      searchQueries: analyzed.queries,
      limit: CHANNEL_TARGET,
    });
    const remaining = Math.max(0, CHANNEL_TARGET - reused);
    const found = remaining > 0
      ? await findAudienceChannels(analyzed.queries, remaining)
      : { channels: [], inspected: 0, quotaStopped: false };
    if (reused === 0 && found.channels.length === 0) {
      throw new UnrecoverableError(
        found.quotaStopped
          ? "The daily YouTube quota was reached before a matching channel was found."
          : "No public channel in Europe, North America, North Africa, or the Gulf has between 5,000 and 1,000,000 subscribers for this ICP.",
      );
    }

    for (const channel of found.channels) {
      const creator = await upsertMatchedChannel(channel.channel, channel.publishedAt, channel.averageViews);
      await prisma.icpChannelMatch.upsert({
        where: { brandIcpId_creatorId: { brandIcpId: brand.id, creatorId: creator.id } },
        create: { brandIcpId: brand.id, creatorId: creator.id },
        update: {},
      });
      if (creator.channelIcp) continue;
      try {
        const profile = await writeChannelIcp(channel.channel);
        await prisma.creator.update({ where: { id: creator.id }, data: { channelIcp: profile } });
      } catch (error) {
        logger.error("channel icp failed", { creatorId: creator.id, message: error instanceof Error ? error.message : "unknown" });
      }
    }

    const channelCount = await prisma.icpChannelMatch.count({ where: { brandIcpId: brand.id } });
    await attachPublicEmails(brand.id);
    await prisma.brandIcp.update({
      where: { id: brand.id },
      data: {
        status: "COMPLETED",
        matchedChannelCount: channelCount,
        errorSummary: null,
      },
    });
    await prisma.processingJob.update({
      where: { id: processingJobId },
      data: {
        status: "COMPLETED",
        progress: 100,
        totalRecords: reused + found.inspected,
        processedRecords: reused + found.inspected,
        successCount: channelCount,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ICP matching failed.";
    logger.error("icp match failed", { brandIcpId: brand.id, message });
    await prisma.brandIcp.update({
      where: { id: brand.id },
      data: { status: "FAILED", errorSummary: message.slice(0, 800) },
    });
    await prisma.processingJob.update({
      where: { id: processingJobId },
      data: { status: "FAILED", errorSummary: message.slice(0, 800), completedAt: new Date() },
    });
    const quota = error instanceof YouTubeApiError && error.code === "QUOTA";
    if (quota || /quota/i.test(message)) throw new UnrecoverableError(message);
    throw error;
  }
}

const SEARCH_RESULTS = 50;
const CHANNEL_TARGET = 30;

async function attachPublicEmails(brandIcpId: string) {
  const pending = await prisma.creator.findMany({
    where: {
      emailSearchStatus: "NOT_SEARCHED",
      icpChannels: { some: { brandIcpId } },
    },
    select: { id: true },
  });
  for (const creator of pending) {
    try {
      await discoverPublicEmail(creator.id);
    } catch (error) {
      logger.error("icp public email failed", {
        creatorId: creator.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

async function findAudienceChannels(queries: string[], target: number) {
  const kept = new Map<string, { channel: YouTubeChannel; publishedAt: Date | null; averageViews: number | null }>();
  let inspected = 0;
  const filtered = {
    missingCountry: 0,
    outsideRegion: 0,
    hiddenSubscribers: 0,
    belowMinimum: 0,
    aboveMaximum: 0,
  };
  const daily = Number(process.env.YOUTUBE_DAILY_QUOTA || 10000);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const used = await prisma.apiUsage.aggregate({
    _sum: { units: true },
    where: { provider: "youtube", createdAt: { gte: since } },
  });
  let consumed = used._sum.units ?? 0;
  const searchClient = createYouTubeClient(
    fetch,
    async (units, operation, success, message) => {
      consumed += units;
      await prisma.apiUsage.create({
        data: { provider: "youtube", operation, units, success, message: message?.slice(0, 300) },
      });
    },
    (units) => {
      if (consumed + units > daily) {
        throw new YouTubeApiError("The daily YouTube quota budget would be exceeded by the next request.", "QUOTA");
      }
    },
  );
  let quotaStopped = false;
  for (const { query } of icpSearchPlan(queries)) {
    if (kept.size >= target) break;
    let page;
      try {
        page = await searchClient.search({
          query,
          type: "channel",
          order: "relevance",
          maxResults: SEARCH_RESULTS,
        });
      } catch (error) {
        if (error instanceof YouTubeApiError && error.code === "QUOTA") {
          quotaStopped = true;
          break;
        }
        throw error;
      }
      const fresh = [...new Set(page.items.map((item) => item.channelId).filter(Boolean))];
      inspected += fresh.length;
      if (fresh.length === 0) continue;
      const channels = await loadChannels(fresh, searchClient);
      for (const channel of channels) {
        if (!matchesIcpAudience(channel)) {
          if (!channel.country) filtered.missingCountry += 1;
          else if (!ICP_COUNTRIES.includes(channel.country)) filtered.outsideRegion += 1;
          else if (channel.subscriberVisibility !== "PUBLIC" || channel.subscriberCount == null) filtered.hiddenSubscribers += 1;
          else if (channel.subscriberCount < ICP_MIN_SUBSCRIBERS) filtered.belowMinimum += 1;
          else if (channel.subscriberCount > ICP_MAX_SUBSCRIBERS) filtered.aboveMaximum += 1;
          continue;
        }
        kept.set(channel.id, { channel, publishedAt: null, averageViews: null });
      }
      logger.info("icp channel filter", {
        searchResults: page.items.length,
        channelMetadata: channels.length,
        kept: kept.size,
        ...filtered,
      });
  }
  const selected = [...kept.values()].slice(0, target);
  const uploadIds = new Map<string, string[]>();
  for (const entry of selected) {
    const playlistId = entry.channel.uploadsPlaylistId;
    if (!playlistId) continue;
    try {
      const uploads = await searchClient.listUploads(playlistId, 20);
      uploadIds.set(entry.channel.id, uploads.map((item) => item.videoId));
      const published = uploads[0]?.publishedAt;
      const date = published ? new Date(published) : null;
      if (date && !Number.isNaN(date.getTime())) entry.publishedAt = date;
    } catch (error) {
      if (error instanceof YouTubeApiError && error.code === "QUOTA") {
        quotaStopped = true;
        break;
      }
      logger.warn("icp latest video skipped", {
        channelId: entry.channel.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  const details = new Map<string, YouTubeVideoDetails>();
  const videoIds = [...new Set([...uploadIds.values()].flat())];
  try {
    for (let index = 0; index < videoIds.length; index += 50) {
      const batch = await searchClient.listVideos(videoIds.slice(index, index + 50));
      for (const video of batch) details.set(video.id, video);
    }
  } catch (error) {
    if (error instanceof YouTubeApiError && error.code === "QUOTA") quotaStopped = true;
    else logger.warn("icp video stats skipped", { message: error instanceof Error ? error.message : "unknown" });
  }
  for (const entry of selected) {
    const videos = (uploadIds.get(entry.channel.id) ?? [])
      .map((id) => details.get(id))
      .filter((video): video is YouTubeVideoDetails => Boolean(video));
    const activity = selectRecentPublicVideos(videos);
    if (activity.averageViews != null) entry.averageViews = activity.averageViews;
    const active = activity.lastActiveAt ? new Date(activity.lastActiveAt) : null;
    if (active && !Number.isNaN(active.getTime())) entry.publishedAt = active;
  }
  return { channels: selected, inspected, quotaStopped };
}

async function loadChannels(ids: string[], client: YouTubeClient) {
  if (ids.length === 0) return [];
  const channels = [];
  for (let index = 0; index < ids.length; index += 50) {
    channels.push(...(await client.listChannels(ids.slice(index, index + 50))));
  }
  return channels;
}
