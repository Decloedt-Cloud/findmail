import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ICP_COUNTRIES,
  ICP_MAX_SUBSCRIBERS,
  ICP_MIN_SUBSCRIBERS,
  channelInRequestedRegion,
  icpSearchPlan,
  matchesIcpAudience,
  regionSearchCodes,
} from "@/lib/icp/audience";
import { writeChannelIcp } from "@/lib/icp/channel-icp";
import { discoverPublicEmail } from "@/lib/icp/public-email";
import { UnrecoverableError } from "bullmq";
import { searchQueriesForIcp } from "@/lib/icp/deepseek";
import { reuseStoredCreators } from "@/lib/icp/reuse";
import { upsertMatchedChannel } from "@/lib/icp/store";
import { YouTubeApiError, YouTubeClient, createYouTubeClient, matchesSubscriberRange, type YouTubeChannel, type YouTubeVideoDetails } from "@/lib/youtube/client";
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

    const countries = snapshotCountries(brand.snapshot);
    const target = channelTarget(brand.snapshot);
    const reused = await reuseStoredCreators({
      brandIcpId: brand.id,
      brandName: brand.brandName,
      snapshot: brand.snapshot,
      searchQueries: analyzed.queries,
      limit: target,
      countries,
    });
    const remaining = Math.max(0, target - reused);
    const found = remaining > 0
      ? await findAudienceChannels(analyzed.queries, remaining, countries)
      : { channels: [], inspected: 0, quotaStopped: false };
    if (reused === 0 && found.channels.length === 0) {
      throw new UnrecoverableError(
        found.quotaStopped
          ? "The daily YouTube quota was reached before a matching channel was found."
          : countries.length
            ? "No public YouTube channel was found in the requested countries for this ICP."
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
    }

    await attachPublicEmails(brand.id);
    await prisma.icpChannelMatch.deleteMany({
      where: {
        brandIcpId: brand.id,
        creator: {
          emails: { none: {} },
          instagramUrl: null,
          twitterUrl: null,
          tiktokUrl: null,
        },
      },
    });
    const kept = await prisma.creator.findMany({
      where: { channelIcp: { equals: Prisma.DbNull }, icpChannels: { some: { brandIcpId: brand.id } } },
      select: { id: true, youtubeChannelId: true },
    });
    const byYoutube = new Map(found.channels.map((row) => [row.channel.id, row.channel]));
    for (const creator of kept) {
      const channel = byYoutube.get(creator.youtubeChannelId);
      if (!channel) continue;
      try {
        const profile = await writeChannelIcp(channel);
        await prisma.creator.update({ where: { id: creator.id }, data: { channelIcp: profile } });
      } catch (error) {
        logger.error("channel icp failed", { creatorId: creator.id, message: error instanceof Error ? error.message : "unknown" });
      }
    }

    const channelCount = await prisma.icpChannelMatch.count({ where: { brandIcpId: brand.id } });
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
const CHANNEL_TARGET = 50;

function snapshotCountries(snapshot: unknown): string[] {
  const raw = snapshot && typeof snapshot === "object" ? (snapshot as { countries?: unknown }).countries : null;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.flatMap((code) => {
    if (typeof code !== "string" || !/^[A-Za-z]{2}$/.test(code.trim())) return [];
    return [code.trim().toUpperCase()];
  }))];
}

function channelTarget(snapshot: unknown) {
  const raw = snapshot && typeof snapshot === "object" ? Number((snapshot as { maxChannels?: unknown }).maxChannels) : NaN;
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return Math.floor(raw);
  return CHANNEL_TARGET;
}

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

function countrySearchPhrases(queries: string[]) {
  const seen = new Set<string>();
  const phrases: { query: string }[] = [];
  for (const query of queries) {
    const clean = query.replace(/\|/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    phrases.push({ query: clean });
    if (phrases.length >= 3) break;
  }
  return phrases.length > 0 ? phrases : icpSearchPlan(queries);
}

async function findAudienceChannels(queries: string[], target: number, countries: string[] = []) {
  const poolTarget = target * 3;
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
  const singleCountry = countries.length === 1;
  const regions = countries.length === 0 ? [undefined] : countries.length <= 20 ? countries : regionSearchCodes(countries);
  const phrases = singleCountry ? countrySearchPhrases(queries) : icpSearchPlan(queries);
  const maxPages = singleCountry ? 2 : 1;
  for (const regionCode of regions) {
    if (kept.size >= poolTarget || quotaStopped) break;
    for (const { query } of phrases) {
      if (kept.size >= poolTarget || quotaStopped) break;
      let pageToken: string | undefined;
      for (let pageIndex = 0; pageIndex < maxPages && kept.size < poolTarget; pageIndex += 1) {
        let page;
        try {
          page = await searchClient.search({
            query,
            type: "channel",
            order: "relevance",
            maxResults: SEARCH_RESULTS,
            regionCode,
            pageToken,
          });
        } catch (error) {
          if (error instanceof YouTubeApiError && error.code === "QUOTA") {
            quotaStopped = true;
            break;
          }
          throw error;
        }
        pageToken = page.nextPageToken;
        const fresh = [...new Set(page.items.map((item) => item.channelId).filter(Boolean))];
        inspected += fresh.length;
        if (fresh.length > 0) {
          const channels = await loadChannels(fresh, searchClient);
          for (const channel of channels) {
            const inRegion = countries.length
              ? channelInRequestedRegion(channel.country, countries)
              : ICP_COUNTRIES.includes((channel.country || "").toUpperCase());
            const inBand = matchesSubscriberRange(
              channel.subscriberVisibility,
              channel.subscriberCount,
              ICP_MIN_SUBSCRIBERS,
              ICP_MAX_SUBSCRIBERS,
            );
            const strict = countries.length ? inRegion && inBand : matchesIcpAudience(channel);
            if (strict) kept.set(channel.id, { channel, publishedAt: null, averageViews: null });
            else if (!channel.country) filtered.missingCountry += 1;
            else if (!inRegion) filtered.outsideRegion += 1;
            else if (channel.subscriberVisibility !== "PUBLIC" || channel.subscriberCount == null) filtered.hiddenSubscribers += 1;
            else if ((channel.subscriberCount ?? 0) < ICP_MIN_SUBSCRIBERS) filtered.belowMinimum += 1;
            else filtered.aboveMaximum += 1;
          }
          logger.info("icp channel filter", {
            regionCode: regionCode ?? null,
            searchResults: page.items.length,
            channelMetadata: channels.length,
            kept: kept.size,
            ...filtered,
          });
        }
        if (!pageToken) break;
      }
    }
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
  return { channels: selected.slice(0, target), inspected, quotaStopped };
}

async function loadChannels(ids: string[], client: YouTubeClient) {
  if (ids.length === 0) return [];
  const channels = [];
  for (let index = 0; index < ids.length; index += 50) {
    channels.push(...(await client.listChannels(ids.slice(index, index + 50))));
  }
  return channels;
}
