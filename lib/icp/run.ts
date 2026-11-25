import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ICP_MAX_SUBSCRIBERS,
  ICP_MIN_SUBSCRIBERS,
  channelInRequestedRegion,
  icpSearchPlan,
  regionSearchCodes,
} from "@/lib/icp/audience";
import { hasPublicContact, USABLE_CONTACT } from "@/lib/creators/contact";
import { writeChannelIcp } from "@/lib/icp/channel-icp";
import { discoverPublicEmail } from "@/lib/icp/public-email";
import { UnrecoverableError } from "bullmq";
import { searchQueriesForIcp } from "@/lib/icp/deepseek";
import { snapshotSearchLanguages } from "@/lib/icp/search-language";
import { confirmSpokenCreatorIds, refreshUncheckedLanguages, resumeUnreadCreators, skipSettledCountryMisses, skipSettledLanguageMisses } from "@/lib/icp/confirm-spoken";
import { reuseStoredCreators } from "@/lib/icp/reuse";
import { selectCreatorsForIcp } from "@/lib/icp/select-creators";
import { upsertMatchedChannel } from "@/lib/icp/store";
import { YouTubeApiError, YouTubeClient, createYouTubeClient, matchesSubscriberRange, type YouTubeChannel, type YouTubeVideoDetails } from "@/lib/youtube/client";
import { selectRecentPublicVideos } from "@/lib/youtube/metrics";
import { contentCountryList, readContentCountries, storedCountriesCover } from "@/lib/youtube/content-country";
import { channelLanguageRead, isSpecificLanguageChoice, storedLanguageCovers } from "@/lib/youtube/spoken-language";
import { icpSearchPausedUntil, youtubeQuotaDayStart } from "@/lib/youtube/quota-day";

export async function runMatchIcpChannels(processingJobId: string) {
  const brand = await prisma.brandIcp.findUnique({ where: { processingJobId } });
  if (!brand) throw new Error("ICP match is missing its saved profile.");
  if (brand.status === "COMPLETED" && brand.matchedChannelCount > 0) return;

  const pausedUntil = icpSearchPausedUntil();
  if (pausedUntil && Date.now() < pausedUntil.getTime()) {
    const message = `ICP matching is paused until ${pausedUntil.toISOString()} to stay within the YouTube daily search limit.`;
    await prisma.brandIcp.update({ where: { id: brand.id }, data: { status: "FAILED", errorSummary: message } });
    await prisma.processingJob.update({
      where: { id: processingJobId },
      data: { status: "FAILED", errorSummary: message, completedAt: new Date() },
    });
    logger.warn("icp match paused", { brandIcpId: brand.id, pausedUntil: pausedUntil.toISOString() });
    return;
  }

  await prisma.brandIcp.update({
    where: { id: brand.id },
    data: { status: "RUNNING", errorSummary: null },
  });
  await markSearchPhase(brand.id, brand.snapshot, "catalog");
  await prisma.processingJob.update({
    where: { id: processingJobId },
    data: { status: "RUNNING", startedAt: new Date(), progress: 10 },
  });

  try {
    const languages = snapshotSearchLanguages(brand.snapshot);
    const countries = snapshotCountries(brand.snapshot);
    const target = channelTarget(brand.snapshot);
    const requestId = snapshotRequestId(brand.snapshot);
    const alreadyProposed = requestId
      ? await creatorsProposedOnOtherRequests(brand.wayoOnboardingId, brand.id, requestId)
      : { creatorIds: [] as string[], youtubeChannelIds: new Set<string>() };
    /* A search again adds a batch behind the one this request already carries, so
       those channels are not candidates for it: they were already proposed. */
    const own = await prisma.icpChannelMatch.findMany({
      where: { brandIcpId: brand.id },
      select: { creatorId: true, creator: { select: { youtubeChannelId: true } } },
    });
    const linkedBefore = own.length;
    const excludedCreatorIds = [...new Set([...alreadyProposed.creatorIds, ...own.map((link) => link.creatorId)])];
    const skipChannelIds = new Set(alreadyProposed.youtubeChannelIds);
    for (const link of own) {
      if (link.creator.youtubeChannelId) skipChannelIds.add(link.creator.youtubeChannelId);
    }
    const catalogClient = await openMatchYouTubeClient();
    const resumed = await resumeUnreadCreators(catalogClient, countries, languages, skipChannelIds);
    if (resumed.length > 0) {
      await prisma.icpChannelMatch.createMany({
        data: resumed.map((creatorId) => ({ brandIcpId: brand.id, creatorId })),
        skipDuplicates: true,
      });
    }
    await refreshUncheckedLanguages(catalogClient, own.map((link) => link.creatorId));
    const catalog = await reuseStoredCreators({
      brandIcpId: brand.id,
      brandName: brand.brandName,
      snapshot: brand.snapshot,
      searchQueries: brand.searchQueries,
      limit: target,
      countries,
      language: languages[0] ?? null,
      languages,
      excludeCreatorIds: excludedCreatorIds,
      confirmIds: (ids) => confirmSpokenCreatorIds(catalogClient, ids, languages),
    });
    // `linked` is the row's total, not this run's share.
    const reused = Math.max(0, catalog.linked - linkedBefore);
    const remaining = Math.max(0, target - reused);
    // A catalog that did not fill this batch has not answered the site. The next
    // search is written for this ICP. Reusing "whoever was stored last" is not a result.
    let queries = brand.searchQueries;
    let found: Awaited<ReturnType<typeof findAudienceChannels>> = {
      channels: [],
      unread: [],
      dropped: [],
      inspected: 0,
      quotaStopped: false,
    };
    if (remaining > 0) {
      await skipSettledLanguageMisses(skipChannelIds, languages);
      await skipSettledCountryMisses(skipChannelIds, countries);
      await markSearchPhase(brand.id, brand.snapshot, "writing");
      const analyzed = await searchQueriesForIcp({
        brandName: brand.brandName,
        websiteUrl: brand.websiteUrl,
        snapshot: brand.snapshot,
        language: languages[0] ?? null,
        languages,
      });
      queries = analyzed.queries;
      await prisma.brandIcp.update({
        where: { id: brand.id },
        data: { searchQueries: analyzed.queries, analysisNote: analyzed.note || null },
      });
      await markSearchPhase(brand.id, brand.snapshot, "youtube");
      found = await findAudienceChannels(analyzed.queries, remaining, countries, skipChannelIds, languages);
    }
    if (reused === 0 && found.channels.length === 0) {
      if (found.quotaStopped) {
        throw new UnrecoverableError(
          "The daily YouTube quota was reached before a matching channel was found.",
        );
      }
      await completeMatchWithNoChannels({
        brandId: brand.id,
        processingJobId,
        inspected: found.inspected,
        note: countries.length
          ? "No public YouTube channel was found in the requested countries for this ICP."
          : "No public channel between 5,000 and 1,000,000 subscribers was found for this ICP.",
      });
      return;
    }

    const blocked = new Set(excludedCreatorIds);
    const freshCreators = [];
    const createdCandidateIds: string[] = [];
    for (const channel of found.channels) {
      let saved;
      try {
        saved = await upsertMatchedChannel(
          channel.channel,
          channel.publishedAt,
          channel.averageViews,
          {
            publishesLongForm: channel.publishesLongForm,
            publishesShorts: channel.publishesShorts,
          },
          channel.searchRegion,
          channel.languageSettled,
          channel.contentCountries,
        );
      } catch (error) {
        // One channel that cannot be saved must not fail the whole search. It is skipped
        // and logged, so the other channels of this batch still reach the advertiser.
        logger.warn("icp channel skipped", {
          brandIcpId: brand.id,
          channelId: channel.channel.id,
          message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        });
        continue;
      }
      const { creator, created } = saved;
      if (blocked.has(creator.id)) continue;
      if (created) createdCandidateIds.push(creator.id);
      freshCreators.push(creator);
    }
    for (const channel of [...found.unread, ...found.dropped]) {
      try {
        await upsertMatchedChannel(
          channel.channel,
          channel.publishedAt,
          channel.averageViews,
          {
            publishesLongForm: channel.publishesLongForm,
            publishesShorts: channel.publishesShorts,
          },
          channel.searchRegion,
          channel.languageSettled,
          channel.contentCountries,
        );
      } catch (error) {
        logger.warn("icp unread channel skipped", {
          brandIcpId: brand.id,
          channelId: channel.channel.id,
          message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        });
      }
    }
    const selectedFresh = await selectCreatorsForIcp({
      brandName: brand.brandName,
      snapshot: brand.snapshot,
      searchQueries: queries,
      candidates: freshCreators.map((creator) => ({
        id: creator.id,
        channelName: creator.channelName,
        description: creator.description,
        keywords: creator.keywords,
        channelIcp: creator.channelIcp,
      })),
      limit: remaining,
    });
    const deepseekSelected = selectedFresh.length;
    const selectedSet = new Set(selectedFresh);
    for (const creatorId of selectedFresh) {
      await prisma.icpChannelMatch.upsert({
        where: { brandIcpId_creatorId: { brandIcpId: brand.id, creatorId } },
        create: { brandIcpId: brand.id, creatorId },
        update: {},
      });
    }
    const orphanIds = createdCandidateIds.filter((id) => !selectedSet.has(id));
    if (orphanIds.length > 0) {
      await prisma.jobItem.updateMany({ where: { creatorId: { in: orphanIds } }, data: { creatorId: null } });
      await prisma.creator.deleteMany({
        where: {
          id: { in: orphanIds },
          icpChannels: { none: {} },
        },
      });
    }

    await attachPublicEmails(brand.id);
    await writeMissingChannelIcps(brand.id, found.channels.map((row) => row.channel));
    await pruneUnusableMatches(brand.id);
    // Channels created for this run must not stay in the catalog without a contact.
    if (createdCandidateIds.length > 0) {
      await discardCreatedWithoutContact(createdCandidateIds);
    }

    const channelCount = await prisma.icpChannelMatch.count({ where: { brandIcpId: brand.id } });
    if (channelCount === 0) {
      const noRelevance = deepseekSelected === 0 && selectedFresh.length === 0;
      await completeMatchWithNoChannels({
        brandId: brand.id,
        processingJobId,
        inspected: reused + found.inspected,
        note: noRelevance
          ? countries.length
            ? "No YouTube channel clearly matched this ICP in the requested countries."
            : "No YouTube channel clearly matched this ICP."
          : countries.length
            ? "Matching channels were found, but none had public contact details in the requested countries."
            : "Matching channels were found, but none had public contact details (email, Instagram, X, or TikTok).",
      });
      return;
    }
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

/** Empty match is a finished search, not a failed job. A new search needs a
 *  different country or language, or an explicit search again.
 *  A search again that finds nothing keeps the batch already on the request. */
async function completeMatchWithNoChannels(input: {
  brandId: string;
  processingJobId: string;
  inspected: number;
  note: string;
}) {
  const kept = await prisma.icpChannelMatch.count({ where: { brandIcpId: input.brandId } });
  await prisma.brandIcp.update({
    where: { id: input.brandId },
    data: {
      status: "COMPLETED",
      matchedChannelCount: kept,
      errorSummary: input.note.slice(0, 800),
    },
  });
  await prisma.processingJob.update({
    where: { id: input.processingJobId },
    data: {
      status: "COMPLETED",
      progress: 100,
      totalRecords: input.inspected,
      processedRecords: input.inspected,
      successCount: kept,
      errorSummary: input.note.slice(0, 800),
      completedAt: new Date(),
    },
  });
}

async function attachPublicEmails(brandIcpId: string) {
  const pending = await prisma.creator.findMany({
    where: {
      // A stored channel already has an email or a social profile. Do not crawl it again.
      emailSearchStatus: { in: ["NOT_SEARCHED", "NOT_FOUND"] },
      icpChannels: { some: { brandIcpId } },
      NOT: USABLE_CONTACT,
    },
    select: { id: true },
  });
  for (const creator of pending) {
    try {
      await prisma.creator.update({
        where: { id: creator.id },
        data: { emailSearchStatus: "NOT_SEARCHED" },
      });
      await discoverPublicEmail(creator.id);
    } catch (error) {
      logger.error("icp public email failed", {
        creatorId: creator.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

async function writeMissingChannelIcps(brandIcpId: string, youtubeChannels: YouTubeChannel[]) {
  const byYoutube = new Map(youtubeChannels.map((channel) => [channel.id, channel]));
  const missing = await prisma.creator.findMany({
    where: {
      channelIcp: { equals: Prisma.DbNull },
      icpChannels: { some: { brandIcpId } },
    },
    select: {
      id: true,
      youtubeChannelId: true,
      channelName: true,
      description: true,
      keywords: true,
      country: true,
    },
  });
  for (const creator of missing) {
    const youtube = byYoutube.get(creator.youtubeChannelId);
    const source = youtube
      ? {
          id: youtube.id,
          title: youtube.title,
          description: youtube.description,
          keywords: youtube.keywords,
          country: youtube.country,
        }
      : {
          id: creator.youtubeChannelId,
          title: creator.channelName,
          description: creator.description || "",
          keywords: creator.keywords,
          country: creator.country,
        };
    try {
      const profile = await writeChannelIcp(source);
      await prisma.creator.update({ where: { id: creator.id }, data: { channelIcp: profile } });
      const { rememberCreatorEmbedding } = await import("@/lib/icp/vector-search");
      await rememberCreatorEmbedding(creator.id).catch((error) => {
        logger.warn("channel embedding skipped", {
          creatorId: creator.id,
          message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        });
      });
    } catch (error) {
      logger.error("channel icp failed", {
        creatorId: creator.id,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

async function discardCreatedWithoutContact(creatorIds: string[]) {
  const rows = await prisma.creator.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      instagramUrl: true,
      twitterUrl: true,
      tiktokUrl: true,
      emails: {
        where: {
          verificationStatus: { notIn: ["INVALID", "NOT_FOUND"] as const },
          emailAddress: { not: "" },
        },
        select: { id: true },
        take: 1,
      },
      _count: { select: { icpChannels: true } },
    },
  });
  for (const creator of rows) {
    if (
      hasPublicContact({
        instagramUrl: creator.instagramUrl,
        twitterUrl: creator.twitterUrl,
        tiktokUrl: creator.tiktokUrl,
        emailCount: creator.emails.length,
      })
    ) {
      continue;
    }
    if (creator._count.icpChannels > 0) continue;
    await prisma.jobItem.updateMany({ where: { creatorId: creator.id }, data: { creatorId: null } });
    await prisma.creator.deleteMany({ where: { id: creator.id } });
  }
}

/** Drop matches Wayo cannot propose: no usable contact, or no channel ICP.
 *  Creators left without contact (and without another ICP link) are removed from the catalog. */
async function pruneUnusableMatches(brandIcpId: string) {
  const matches = await prisma.icpChannelMatch.findMany({
    where: { brandIcpId },
    select: {
      id: true,
      creatorId: true,
      creator: {
        select: {
          id: true,
          channelIcp: true,
          instagramUrl: true,
          twitterUrl: true,
          tiktokUrl: true,
          emails: {
            where: {
              verificationStatus: { notIn: ["INVALID", "NOT_FOUND"] as const },
              emailAddress: { not: "" },
            },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const dropped = matches.filter((match) => {
    const creator = match.creator;
    const reachable = hasPublicContact({
      instagramUrl: creator.instagramUrl,
      twitterUrl: creator.twitterUrl,
      tiktokUrl: creator.tiktokUrl,
      emailCount: creator.emails.length,
    });
    const hasIcp = creator.channelIcp != null;
    return !reachable || !hasIcp;
  });
  if (dropped.length === 0) return;

  await prisma.icpChannelMatch.deleteMany({ where: { id: { in: dropped.map((row) => row.id) } } });

  const unreachableIds = [
    ...new Set(
      dropped
        .filter((row) => {
          const creator = row.creator;
          return !hasPublicContact({
            instagramUrl: creator.instagramUrl,
            twitterUrl: creator.twitterUrl,
            tiktokUrl: creator.tiktokUrl,
            emailCount: creator.emails.length,
          });
        })
        .map((row) => row.creatorId),
    ),
  ];
  for (const creatorId of unreachableIds) {
    const stillLinked = await prisma.icpChannelMatch.count({ where: { creatorId } });
    if (stillLinked > 0) continue;
    await prisma.jobItem.updateMany({ where: { creatorId }, data: { creatorId: null } });
    await prisma.creator.deleteMany({ where: { id: creatorId } });
  }
}

function snapshotRequestId(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const id = (snapshot as { requestId?: unknown }).requestId;
  return typeof id === "string" ? id : "";
}

/** Creators already proposed for a different request of this onboarding. */
async function creatorsProposedOnOtherRequests(onboardingId: string, brandIcpId: string, requestId: string) {
  const rows = await prisma.brandIcp.findMany({
    where: { wayoOnboardingId: onboardingId, id: { not: brandIcpId } },
    select: {
      snapshot: true,
      channels: { select: { creatorId: true, creator: { select: { youtubeChannelId: true } } } },
    },
  });
  const creatorIds: string[] = [];
  const youtubeChannelIds = new Set<string>();
  for (const row of rows) {
    const other = snapshotRequestId(row.snapshot);
    if (!other || other === requestId) continue;
    for (const link of row.channels) {
      creatorIds.push(link.creatorId);
      if (link.creator.youtubeChannelId) youtubeChannelIds.add(link.creator.youtubeChannelId);
    }
  }
  return { creatorIds: [...new Set(creatorIds)], youtubeChannelIds };
}

/** Two comment pages per channel, and a cap so a quiet batch cannot spend the day's quota. */
const COMMENT_CALL_BUDGET = 240;
const CREATOR_COMMENT_VIDEOS = 30;
const UPLOAD_SAMPLE = 200;

async function openMatchYouTubeClient() {
  const daily = Number(process.env.YOUTUBE_DAILY_QUOTA || 10000);
  const since = youtubeQuotaDayStart();
  const used = await prisma.apiUsage.aggregate({
    _sum: { units: true },
    where: { provider: "youtube", createdAt: { gte: since } },
  });
  let consumed = used._sum.units ?? 0;
  return createYouTubeClient(
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
}

async function findAudienceChannels(
  queries: string[],
  target: number,
  countries: string[] = [],
  skipChannelIds: Set<string> = new Set(),
  languages: string[] = [],
) {
  const poolTarget = target * 3;
  const kept = new Map<string, {
    channel: YouTubeChannel;
    publishedAt: Date | null;
    averageViews: number | null;
    publishesLongForm: boolean | null;
    publishesShorts: boolean | null;
    searchRegion: string | null;
    languageSettled: boolean;
    languageOk: boolean;
    awaitContentCountry: boolean;
    contentCountries: string | null;
    textsReady: boolean;
  }>();
  const unplaced = new Map<string, {
    channel: YouTubeChannel;
    publishedAt: Date | null;
    averageViews: number | null;
    publishesLongForm: boolean | null;
    publishesShorts: boolean | null;
    searchRegion: string | null;
    languageSettled: boolean;
    languageOk: boolean;
    awaitContentCountry: boolean;
    contentCountries: string | null;
    textsReady: boolean;
  }>();
  let inspected = 0;
  const filtered = {
    missingCountry: 0,
    outsideRegion: 0,
    hiddenSubscribers: 0,
    belowMinimum: 0,
    aboveMaximum: 0,
  };
  const searchClient = await openMatchYouTubeClient();
  let quotaStopped = false;
  const spoken = languages.filter(Boolean);
  const multiLanguage = spoken.length > 1;
  const singleCountry = countries.length === 1;
  const regions = multiLanguage
    ? [singleCountry ? countries[0] : undefined]
    : countries.length === 0
      ? [undefined]
      : countries.length <= 20
        ? countries
        : regionSearchCodes(countries);
  const languagePasses: Array<string | null> = multiLanguage ? spoken : [spoken[0] ?? null];
  const phrases = icpSearchPlan(queries);
  const maxPages = singleCountry && !multiLanguage ? 2 : 1;
  for (const relevanceLanguage of languagePasses) {
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
            relevanceLanguage: relevanceLanguage || undefined,
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
            const declaredMatch = countries.length === 0 || channelInRequestedRegion(channel.country, countries);
            const inBand = matchesSubscriberRange(
              channel.subscriberVisibility,
              channel.subscriberCount,
              ICP_MIN_SUBSCRIBERS,
              ICP_MAX_SUBSCRIBERS,
            );
            const strict = declaredMatch && inBand;
            if (skipChannelIds.has(channel.id)) continue;
            if (strict) kept.set(channel.id, {
              channel,
              publishedAt: null,
              averageViews: null,
              publishesLongForm: null,
              publishesShorts: null,
              searchRegion: null,
              languageSettled: false,
              languageOk: false,
              awaitContentCountry: false,
              contentCountries: null,
              textsReady: false,
            });
            else if (
              inBand
              && !declaredMatch
              && unplaced.size < 12
              && !unplaced.has(channel.id)
            ) {
              unplaced.set(channel.id, {
                channel,
                publishedAt: null,
                averageViews: null,
                publishesLongForm: null,
                publishesShorts: null,
                searchRegion: null,
                languageSettled: false,
                languageOk: false,
                awaitContentCountry: true,
                contentCountries: null,
                textsReady: false,
              });
            }
            else if (!channel.country) filtered.missingCountry += 1;
            else if (!declaredMatch) filtered.outsideRegion += 1;
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
  }
  const pool = isSpecificLanguageChoice(languages) ? target * 2 : target;
  const selected = [...[...kept.values()].slice(0, pool), ...unplaced.values()];
  const uploadIds = new Map<string, string[]>();
  for (const entry of selected) {
    const playlistId = entry.channel.uploadsPlaylistId;
    if (!playlistId) continue;
    try {
      const uploads = await searchClient.listUploads(playlistId, UPLOAD_SAMPLE);
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
  let commentCalls = 0;
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
    entry.publishesLongForm = activity.publishesLongForm;
    entry.publishesShorts = activity.publishesShorts;
    const active = activity.lastActiveAt ? new Date(activity.lastActiveAt) : null;
    if (active && !Number.isNaN(active.getTime())) entry.publishedAt = active;
    const recentIds = new Set(activity.retained.map((video) => video.id));
    const posts = (recentIds.size > 0 ? videos.filter((video) => recentIds.has(video.id)) : videos).map((video) => ({
      id: video.id,
      title: video.title,
      description: video.description,
      creatorComments: [] as string[],
      about: false,
    }));
    if (entry.channel.description.trim()) {
      posts.push({ id: "", title: "", description: entry.channel.description, creatorComments: [], about: true });
    }
    const placeTexts = posts.map((post) => ({
      title: post.title,
      description: post.description,
      about: post.about,
    }));
    if (entry.channel.keywords.length > 0) {
      placeTexts.push({ title: "", description: entry.channel.keywords.join(" "), about: true });
    }
    const listedUploads = uploadIds.has(entry.channel.id) || !entry.channel.uploadsPlaylistId;
    const expectedUploads = uploadIds.get(entry.channel.id) ?? [];
    const textsReady = listedUploads && (expectedUploads.length === 0 || videos.length > 0 || !quotaStopped);
    const hasCommentTarget = posts.some((post) => post.id);
    let commentsFinished = textsReady && !hasCommentTarget;
    if (textsReady && hasCommentTarget && !quotaStopped && commentCalls < COMMENT_CALL_BUDGET) {
      commentsFinished = true;
      let fetched = 0;
      for (const post of posts) {
        if (!post.id || fetched >= CREATOR_COMMENT_VIDEOS) break;
        if (commentCalls >= COMMENT_CALL_BUDGET) {
          commentsFinished = false;
          break;
        }
        try {
          post.creatorComments = await searchClient.listCommentTexts(post.id);
          commentCalls += 1;
          fetched += 1;
        } catch (error) {
          if (error instanceof YouTubeApiError && error.code === "QUOTA") quotaStopped = true;
          commentsFinished = false;
          break;
        }
      }
    }
    const read = textsReady ? channelLanguageRead(posts) : { language: null, conclusive: false };
    const places = textsReady ? readContentCountries(placeTexts) : { countries: [], conclusive: false };
    entry.contentCountries = contentCountryList(places.countries) ?? (places.conclusive ? "" : null);
    entry.textsReady = textsReady;
    // A short sample that names no language is read again later. A finished read is kept.
    entry.languageSettled = textsReady && commentsFinished && read.conclusive;
    const spoken = read.language;
    entry.channel.defaultLanguage = spoken;
    if (!textsReady) continue;
    entry.languageOk = !isSpecificLanguageChoice(languages) || storedLanguageCovers(spoken, languages);
  }
  const matching = selected.filter((entry) => {
    if (!entry.languageOk) return false;
    if (!entry.awaitContentCountry || countries.length === 0) return true;
    return storedCountriesCover(entry.contentCountries, countries);
  });
  const matched = new Set(matching);
  return {
    channels: matching.slice(0, target),
    unread: selected.filter((entry) => !entry.textsReady),
    dropped: selected.filter((entry) => entry.textsReady && entry.languageSettled && !matched.has(entry)),
    inspected,
    quotaStopped,
  };
}

/** The step the advertiser is shown. Kept off the ICP text sent to the model. */
async function markSearchPhase(brandId: string, snapshot: unknown, phase: "catalog" | "writing" | "youtube") {
  const base =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? { ...(snapshot as Record<string, unknown>) }
      : {};
  await prisma.brandIcp.update({
    where: { id: brandId },
    data: { snapshot: { ...base, searchPhase: phase } as Prisma.InputJsonValue },
  });
}

async function loadChannels(ids: string[], client: YouTubeClient) {
  if (ids.length === 0) return [];
  const channels = [];
  for (let index = 0; index < ids.length; index += 50) {
    channels.push(...(await client.listChannels(ids.slice(index, index + 50))));
  }
  return channels;
}
