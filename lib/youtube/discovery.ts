import { publicContactsFromDescriptions } from "@/lib/youtube/contacts";
import {
  inspectLimit,
  matchesDeclaredCountry,
  matchesSubscriberRange,
  type YouTubeChannel,
  type YouTubeClient,
  type YouTubeSearchItem,
  type YouTubeVideoDetails,
} from "@/lib/youtube/client";
import { audienceSearchPasses } from "@/lib/youtube/audience";
import { matchTerms, searchQueries } from "@/lib/youtube/terms";
import { AVERAGE_VIEWS_METHOD, fitViewCount, selectRecentPublicVideos } from "@/lib/youtube/metrics";
import type { EmailCandidate } from "@/lib/email/discovery";

export type DiscoveryQuery = {
  keywords: string[];
  countries: string[];
  language?: string | null;
  minSubscribers?: number | null;
  maxSubscribers?: number | null;
  maxResults: number;
  recencyDays?: number | null;
  excludeChannelIds?: string[];
};

export type MatchedVideo = {
  title: string | null;
  url: string | null;
  views: number | null;
  publishedAt: string | null;
};

export type DiscoveredChannel = YouTubeChannel & {
  discoveryRegion: string | null;
  recentVideoPublishedAt: string | null;
  lastActiveAt: string | null;
  averageViews: number | null;
  averageViewsMethod: string;
  matchedKeywords: string[];
  matchedVideo: MatchedVideo;
  relevanceScore: number;
  recentTitles?: string[];
  instagramUrl: string | null;
  twitterUrl: string | null;
  tiktokUrl: string | null;
  officialWebsiteUrl: string | null;
  websiteEvidence: string;
  descriptionEmails: EmailCandidate[];
};

const MAX_PAGES_PER_QUERY = 3;

export type DiscoveryProgress = {
  phase: "searching" | "reading" | "saving";
  scanned: number;
  found: number;
};

export type DiscoveryHooks = {
  onProgress?: (progress: DiscoveryProgress) => void | Promise<void>;
  onChannel?: (channel: DiscoveredChannel) => void | Promise<void>;
};

export function isAutoTopicChannel(title: string) {
  return title.trim().endsWith(" - Topic");
}

const TOPIC_ALIASES: Record<string, string[]> = {
  ai: ["artificial intelligence"],
  "artificial intelligence": ["ai"],
  tech: ["technology", "technologie"],
  technology: ["tech", "technologie"],
  saas: ["software as a service"],
  "software as a service": ["saas"],
  food: ["cooking", "cook", "recipe", "recipes", "chef", "cuisine", "recette"],
  cooking: ["food", "cuisine", "recette"],
  beauty: ["makeup", "skincare", "cosmetics", "beauté", "maquillage"],
  makeup: ["beauty", "beauté", "maquillage"],
  fitness: ["workout", "workouts", "gym", "musculation"],
  workout: ["fitness", "musculation"],
  finance: ["investing", "investment", "investor"],
  investing: ["finance"],
  gaming: ["gamer", "gameplay"],
  gamer: ["gaming"],
  music: ["musician", "songwriter"],
  musician: ["music"],
  education: ["teacher", "tutorial"],
  travel: ["traveler", "tourism"],
  business: ["entreprise", "entrepreneur", "entrepreneuriat"],
  entrepreneur: ["business", "entreprise", "entrepreneuriat"],
  entreprise: ["business", "entrepreneur", "entrepreneuriat"],
  comedy: ["comedian"],
};

export function searchRelevance(input: {
  title: string;
  handle: string | null;
  description?: string | null;
  videoTitle: string | null;
  recentTitles?: string[];
  keywords: string[];
  hasEmail: boolean;
}) {
  const tier = topicTier(input);
  let score = 0;
  if (hits(input.title, input.keywords)) score += 5;
  if (input.handle && hits(input.handle, input.keywords)) score += 3;
  if (input.description && hits(input.description, input.keywords)) score += 4;
  score += Math.min(4, matchingTitles(input).length) * 2;
  if (tier === "strong") score += 2;
  if (input.hasEmail) score += 1;
  return score;
}

export function topicTier(input: {
  title: string;
  handle: string | null;
  description?: string | null;
  videoTitle: string | null;
  recentTitles?: string[];
  keywords: string[];
}): "strong" | "video" | "none" {
  const name = hits(input.title, input.keywords) || (input.handle ? hits(input.handle, input.keywords) : false);
  const description = input.description ? hits(input.description, input.keywords) : false;
  const videos = matchingTitles(input).length;
  if (name || description || videos >= 2) return "strong";
  if (videos >= 1) return "video";
  return "none";
}

function matchingTitles(input: { videoTitle: string | null; recentTitles?: string[]; keywords: string[] }) {
  const titles = [...new Set([input.videoTitle, ...(input.recentTitles ?? [])].filter((title): title is string => Boolean(title)))];
  return titles.filter((title) => hits(title, input.keywords));
}

function hits(text: string, keywords: string[]) {
  return keywords.some((keyword) => keywordHit(text, keyword));
}

function keywordHit(text: string, keyword: string) {
  return matchTerms(keyword).some((term) => termHit(text, term));
}

function termHit(text: string, term: string) {
  const trimmed = term.trim();
  if (!trimmed) return false;
  if (containsTerm(text, trimmed)) return true;
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  for (const word of [trimmed.toLowerCase(), ...words]) {
    for (const alias of TOPIC_ALIASES[word] ?? []) {
      if (containsTerm(text, alias)) return true;
    }
  }
  return false;
}

function containsTerm(text: string, keyword: string) {
  const needle = keyword.trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export async function discoverYouTubeChannels(
  client: YouTubeClient,
  query: DiscoveryQuery,
  shouldStop: () => boolean | Promise<boolean> = () => false,
  hooks?: DiscoveryHooks,
) {
  const wanted = query.maxResults;
  const cap = inspectLimit(wanted);
  const seen = new Set<string>();
  const listedIds = new Set<string>();
  const recentByChannel = new Map<string, string>();
  const keywordsByChannel = new Map<string, Set<string>>();
  const regionByChannel = new Map<string, string>();
  const matchedByChannel = new Map<string, { videoId: string; title: string; description: string; publishedAt?: string }>();
  const kept: DiscoveredChannel[] = [];
  const pending: DiscoveredChannel[] = [];
  const deferred: DiscoveredChannel[] = [];
  const persisted = new Set<string>();
  const excluded = new Set(query.excludeChannelIds ?? []);
  let filteredOut = 0;
  let duplicates = 0;
  const publishedAfter =
    query.recencyDays && query.recencyDays > 0
      ? new Date(Date.now() - query.recencyDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  const countries = query.countries.length > 0 ? query.countries : [""];

  async function report(phase: DiscoveryProgress["phase"]) {
    await hooks?.onProgress?.({ phase, scanned: seen.size, found: kept.length });
  }

  async function accept(channel: DiscoveredChannel) {
    if (persisted.has(channel.id) || kept.some((item) => item.id === channel.id)) return;
    const evidence = {
      title: channel.title,
      handle: channel.customUrl,
      description: channel.description,
      videoTitle: channel.matchedVideo.title,
      recentTitles: channel.recentTitles,
      keywords: query.keywords,
    };
    channel.relevanceScore = searchRelevance({ ...evidence, hasEmail: channel.descriptionEmails.length > 0 });
    const tier = topicTier(evidence);
    if (tier !== "strong") {
      filteredOut += 1;
      return;
    }
    if (kept.length >= wanted) return;
    kept.push(channel);
    persisted.add(channel.id);
    await hooks?.onChannel?.(channel);
    await report("reading");
  }

  function stampMatched(channel: DiscoveredChannel) {
    const matched = matchedByChannel.get(channel.id);
    if (!matched) return;
    channel.matchedVideo = {
      title: matched.title,
      url: `https://www.youtube.com/watch?v=${matched.videoId}`,
      views: channel.matchedVideo.views,
      publishedAt: matched.publishedAt ?? channel.matchedVideo.publishedAt,
    };
  }

  async function flushPending() {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    for (const channel of batch) stampMatched(channel);
    await report("reading");
    await enrichActivity(client, batch, matchedByChannel, shouldStop);
    for (const channel of batch) await accept(channel);
  }

  const remember = (hit: YouTubeSearchItem, keyword: string, country: string) => {
    const keywords = keywordsByChannel.get(hit.channelId) ?? new Set<string>();
    keywords.add(keyword);
    keywordsByChannel.set(hit.channelId, keywords);
    if (country && !regionByChannel.has(hit.channelId)) regionByChannel.set(hit.channelId, country);
    if (hit.publishedAt) {
      const current = recentByChannel.get(hit.channelId);
      if (!current || hit.publishedAt > current) recentByChannel.set(hit.channelId, hit.publishedAt);
    }
    if (hit.videoId && !matchedByChannel.has(hit.channelId)) {
      matchedByChannel.set(hit.channelId, {
        videoId: hit.videoId,
        title: hit.videoTitle || hit.title,
        description: hit.description,
        publishedAt: hit.publishedAt,
      });
    }
  };

  for (const country of countries) {
    for (const keyword of query.keywords) {
      for (const term of searchQueries(keyword, country)) {
        for (const pass of audienceSearchPasses(query.minSubscribers, query.maxSubscribers)) {
          let pageToken: string | undefined;
          for (let page = 0; page < MAX_PAGES_PER_QUERY; page += 1) {
            if (await shouldStop()) break;
            if (kept.length + pending.length >= wanted || seen.size >= cap) break;
            await report("searching");
            const result = await client.search({
              query: term,
              type: pass.type,
              order: pass.order,
              regionCode: country || undefined,
              relevanceLanguage: query.language || (country === "FR" ? "fr" : undefined),
              publishedAfter: pass.type === "video" ? publishedAfter : undefined,
              pageToken,
              maxResults: 50,
            });
            const fresh: string[] = [];
            for (const hit of result.items) {
              if (!hit.channelId) continue;
              remember(hit, keyword, country);
              if (excluded.has(hit.channelId) || listedIds.has(hit.channelId) || seen.has(hit.channelId)) {
                duplicates += 1;
                continue;
              }
              listedIds.add(hit.channelId);
              fresh.push(hit.channelId);
            }
            if (fresh.length > 0) {
              const listed = await client.listChannels(fresh);
              const returned = new Set(listed.map((channel) => channel.id));
              filteredOut += fresh.filter((id) => !returned.has(id)).length;
              const pageStrong: DiscoveredChannel[] = [];
              for (const channel of listed) {
                if (isAutoTopicChannel(channel.title) || !matchesDeclaredCountry(channel.country, query.countries) || !matchesSubscriberRange(channel.subscriberVisibility, channel.subscriberCount, query.minSubscribers, query.maxSubscribers)) {
                  filteredOut += 1;
                  continue;
                }
                const built = emptyDiscovery(channel, {
                  discoveryRegion: regionByChannel.get(channel.id) ?? null,
                  recentVideoPublishedAt: recentByChannel.get(channel.id) ?? null,
                  matchedKeywords: [...(keywordsByChannel.get(channel.id) ?? [])],
                });
                stampMatched(built);
                seedChannelContacts(built);
                const tier = topicTier({
                  title: built.title,
                  handle: built.customUrl,
                  description: built.description,
                  videoTitle: built.matchedVideo.title,
                  keywords: query.keywords,
                });
                if (tier === "strong") pageStrong.push(built);
                else if (tier === "video") deferred.push(built);
                else filteredOut += 1;
              }
              pageStrong.sort((left, right) => cheapScore(right, query.keywords) - cheapScore(left, query.keywords));
              const room = Math.max(0, wanted - kept.length - pending.length);
              for (const channel of pageStrong.slice(0, room)) {
                if (seen.size >= cap) break;
                seen.add(channel.id);
                pending.push(channel);
              }
            }
            pageToken = result.nextPageToken;
            if (!pageToken) break;
          }
          if (kept.length + pending.length >= wanted || seen.size >= cap) break;
        }
        if (kept.length + pending.length >= wanted || seen.size >= cap) break;
      }
      if (kept.length + pending.length >= wanted || seen.size >= cap) break;
    }
    if (kept.length + pending.length >= wanted || seen.size >= cap) break;
  }

  await flushPending();

  deferred.sort((left, right) => cheapScore(right, query.keywords) - cheapScore(left, query.keywords));
  let deferredIndex = 0;
  while (kept.length < wanted && deferredIndex < deferred.length && seen.size < cap) {
    if (await shouldStop()) break;
    const need = Math.max(1, wanted - kept.length);
    const slice = deferred.slice(deferredIndex, deferredIndex + Math.min(need, cap - seen.size));
    deferredIndex += slice.length;
    if (slice.length === 0) break;
    for (const channel of slice) seen.add(channel.id);
    for (const channel of slice) stampMatched(channel);
    await report("reading");
    await enrichActivity(client, slice, matchedByChannel, shouldStop);
    for (const channel of slice) await accept(channel);
  }

  kept.sort((left, right) => right.relevanceScore - left.relevanceScore);
  return { channels: kept, duplicates, filteredOut, candidateIds: seen.size };
}

function cheapScore(channel: DiscoveredChannel, keywords: string[]) {
  return searchRelevance({
    title: channel.title,
    handle: channel.customUrl,
    description: channel.description,
    videoTitle: channel.matchedVideo.title,
    keywords,
    hasEmail: channel.descriptionEmails.length > 0,
  });
}

function seedChannelContacts(channel: DiscoveredChannel) {
  const contacts = publicContactsFromDescriptions([
    { text: channel.description, sourceUrl: `https://www.youtube.com/channel/${channel.id}`, video: false },
  ]);
  channel.descriptionEmails = contacts.emails;
  channel.officialWebsiteUrl = contacts.website;
  channel.websiteEvidence = contacts.websiteEvidence;
  channel.instagramUrl = contacts.instagram;
  channel.twitterUrl = contacts.twitter;
  channel.tiktokUrl = contacts.tiktok;
}

export async function loadPublicChannelFields(
  client: YouTubeClient,
  channels: YouTubeChannel[],
  matchedByChannel: Map<string, { videoId: string; title: string; description: string; publishedAt?: string }> = new Map(),
) {
  const discovered = channels.map((channel) =>
    emptyDiscovery(channel, { discoveryRegion: null, recentVideoPublishedAt: null, matchedKeywords: channel.keywords }),
  );
  await enrichActivity(client, discovered, matchedByChannel, () => false);
  return discovered;
}

function emptyDiscovery(
  channel: YouTubeChannel,
  extra: { discoveryRegion: string | null; recentVideoPublishedAt: string | null; matchedKeywords: string[] },
): DiscoveredChannel {
  return {
    ...channel,
    ...extra,
    lastActiveAt: null,
    averageViews: null,
    averageViewsMethod: AVERAGE_VIEWS_METHOD,
    matchedVideo: { title: null, url: null, views: null, publishedAt: null },
    relevanceScore: 0,
    instagramUrl: null,
    twitterUrl: null,
    tiktokUrl: null,
    officialWebsiteUrl: null,
    websiteEvidence: "No official website was found in the public descriptions returned by YouTube.",
    descriptionEmails: [],
  };
}

async function enrichActivity(
  client: YouTubeClient,
  channels: DiscoveredChannel[],
  matchedByChannel: Map<string, { videoId: string; title: string; description: string; publishedAt?: string }>,
  shouldStop: () => boolean | Promise<boolean>,
) {
  const playlistVideos = new Map<string, string[]>();
  for (const channel of channels) {
    if (await shouldStop()) return;
    if (!channel.uploadsPlaylistId) continue;
    try {
      const items = await client.listUploads(channel.uploadsPlaylistId, 20);
      playlistVideos.set(channel.id, items.map((item) => item.videoId));
    } catch {
      playlistVideos.set(channel.id, []);
    }
  }

  const wanted = new Set<string>();
  for (const channel of channels) {
    for (const id of playlistVideos.get(channel.id) ?? []) wanted.add(id);
    const matched = matchedByChannel.get(channel.id);
    if (matched) wanted.add(matched.videoId);
  }
  const details = new Map<string, YouTubeVideoDetails>();
  const ids = [...wanted];
  for (let index = 0; index < ids.length; index += 50) {
    if (await shouldStop()) return;
    const batch = await client.listVideos(ids.slice(index, index + 50));
    for (const video of batch) details.set(video.id, video);
  }

  for (const channel of channels) {
    const uploadDetails = (playlistVideos.get(channel.id) ?? [])
      .map((id) => details.get(id))
      .filter((video): video is YouTubeVideoDetails => Boolean(video));
    const activity = selectRecentPublicVideos(uploadDetails);
    channel.averageViews = activity.averageViews;
    channel.recentTitles = activity.retained.map((video) => video.title);
    channel.lastActiveAt = activity.lastActiveAt;
    channel.recentVideoPublishedAt = activity.lastActiveAt ?? channel.recentVideoPublishedAt;

    const matched = matchedByChannel.get(channel.id);
    const matchedDetails = matched ? details.get(matched.videoId) : undefined;
    if (matched) {
      channel.matchedVideo = {
        title: matchedDetails?.title || matched.title || null,
        url: `https://www.youtube.com/watch?v=${matched.videoId}`,
        views: fitViewCount(matchedDetails?.viewCount ?? null),
        publishedAt: matchedDetails?.publishedAt ?? matched.publishedAt ?? null,
      };
    }

    const parts: Array<{ text: string; sourceUrl: string | null; video: boolean }> = [
      { text: channel.description, sourceUrl: `https://www.youtube.com/channel/${channel.id}`, video: false },
    ];
    if (matched) {
      parts.push({
        text: matchedDetails?.description ?? matched.description ?? "",
        sourceUrl: `https://www.youtube.com/watch?v=${matched.videoId}`,
        video: true,
      });
    }
    const retainedIds = new Set(activity.retained.map((video) => video.id));
    for (const video of uploadDetails) {
      if (!retainedIds.has(video.id) || video.id === matched?.videoId) continue;
      parts.push({
        text: video.description,
        sourceUrl: `https://www.youtube.com/watch?v=${video.id}`,
        video: true,
      });
    }
    const contacts = publicContactsFromDescriptions(parts);
    channel.descriptionEmails = contacts.emails;
    channel.officialWebsiteUrl = contacts.website;
    channel.websiteEvidence = contacts.websiteEvidence;
    channel.instagramUrl = contacts.instagram;
    channel.twitterUrl = contacts.twitter;
    channel.tiktokUrl = contacts.tiktok;
  }
}
