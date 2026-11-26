import { prisma } from "@/lib/db";
import { YouTubeApiError, type YouTubeClient } from "@/lib/youtube/client";
import { contentCountryList, readContentCountries, storedCountriesCover } from "@/lib/youtube/content-country";
import { ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { languageReuseFilter, statedCountryClauses } from "@/lib/icp/reuse";
import { selectRecentPublicVideos } from "@/lib/youtube/metrics";
import { channelLanguageRead, isSpecificLanguageChoice, LANGUAGE_READ_VERSION, storedLanguageCovers } from "@/lib/youtube/spoken-language";
import { JobCancelled } from "@/lib/jobs/progress";

type Stop = () => Promise<void>;

const CREATOR_COMMENT_VIDEOS = 30;
const UPLOAD_SAMPLE = 200;
/** Stored channels re-read on one search once the settled catalog comes up short. */
const STORED_REREAD_LIMIT = 8;

/**
 * Finishes an older read for channels this request already shows.
 * Not used on the search path: a full catalog match must not pay for it, and a
 * short one spends its reads on channels that can still be offered.
 * A quota stop leaves the rest for the next search instead of failing this one.
 */
export async function refreshUncheckedLanguages(
  client: YouTubeClient,
  ids: string[],
  stop?: Stop,
): Promise<void> {
  const pending = ids.filter(Boolean);
  if (pending.length === 0) return;
  const rows = await prisma.creator.findMany({
    where: {
      id: { in: pending },
      OR: [{ languageCheckedAt: null }, { languageReadVersion: { lt: LANGUAGE_READ_VERSION } }],
    },
    select: { id: true, youtubeChannelId: true },
    take: 25,
  });
  for (const row of rows) {
    if (stop) await stop();
    if (!row.youtubeChannelId) continue;
    try {
      const spoken = await readSpokenLanguage(client, row.youtubeChannelId, stop);
      await prisma.creator.update({
        where: { id: row.id },
        data: {
          language: spoken.language,
          ...(spoken.conclusive ? { languageCheckedAt: new Date(), languageReadVersion: LANGUAGE_READ_VERSION } : {}),
          ...(spoken.countries != null ? { contentCountries: spoken.countries } : {}),
        },
      });
    } catch (error) {
      if (error instanceof JobCancelled) throw error;
      if (error instanceof YouTubeApiError && error.code === "QUOTA") return;
    }
  }
}

/**
 * Reads channels a previous search had to leave unread. A finished empty read
 * is kept. A quota stop leaves the rest for the search after this one.
 */
export async function resumeUnreadCreators(
  client: YouTubeClient,
  countries: string[],
  languages: string[],
  skipYoutubeIds: Set<string>,
  stop?: Stop,
  limit = STORED_REREAD_LIMIT,
): Promise<string[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const wanted = countries.map((code) => code.toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code));
  const take = Math.max(0, Math.min(STORED_REREAD_LIMIT, limit));
  if (take === 0) return [];
  const rows = await prisma.creator.findMany({
    where: {
      languageCheckedAt: null,
      lastMetadataSyncAt: { gte: since },
      hidden: false,
      ...(skipYoutubeIds.size > 0 ? { youtubeChannelId: { notIn: [...skipYoutubeIds] } } : {}),
      subscriberVisibility: "PUBLIC",
      subscriberCount: { gte: ICP_MIN_SUBSCRIBERS, lte: ICP_MAX_SUBSCRIBERS },
      AND: [
        { OR: [{ language: null }, { language: "" }] },
        ...(wanted.length
          ? [{
              OR: [
                { country: { in: wanted } },
                ...statedCountryClauses(wanted),
                {
                  AND: [
                    { OR: [{ country: null }, { country: "" }] },
                    { contentCountries: null },
                  ],
                },
              ],
            }]
          : []),
      ],
    },
    orderBy: { lastMetadataSyncAt: "desc" },
    take,
    select: {
      id: true,
      youtubeChannelId: true,
      country: true,
      discoveryRegion: true,
      contentCountries: true,
    },
  });
  const kept: string[] = [];
  for (const row of rows) {
    if (stop) await stop();
    if (!row.youtubeChannelId || skipYoutubeIds.has(row.youtubeChannelId)) continue;
    try {
      const spoken = await readSpokenLanguage(client, row.youtubeChannelId, stop);
      await prisma.creator.update({
        where: { id: row.id },
        data: {
          language: spoken.language,
          ...(spoken.conclusive ? { languageCheckedAt: new Date(), languageReadVersion: LANGUAGE_READ_VERSION } : {}),
          ...(spoken.countries != null ? { contentCountries: spoken.countries } : {}),
        },
      });
      const declared = (row.country || "").toUpperCase();
      const countryOk = wanted.length === 0
        || wanted.includes(declared)
        || storedCountriesCover(spoken.countries != null ? spoken.countries : row.contentCountries, wanted);
      const languageOk = !isSpecificLanguageChoice(languages) || storedLanguageCovers(spoken.language, languages);
      if (countryOk && languageOk) kept.push(row.id);
    } catch (error) {
      if (error instanceof JobCancelled) throw error;
      if (error instanceof YouTubeApiError && error.code === "QUOTA") break;
    }
  }
  return kept;
}

export type SpokenLanguageRead = {
  language: string | null;
  conclusive: boolean;
  countries: string | null;
  /** Mean of the newest public videos already downloaded for this read. */
  averageViews: number | null;
  /** Published time of the newest public video in that same set. */
  lastActiveAt: string | null;
  /** Duration of those videos. Null when none carried a duration. */
  publishesLongForm: boolean | null;
  publishesShorts: boolean | null;
};

/** Language, stated country, and the view stats of one stored channel. */
export async function readSpokenLanguage(
  client: YouTubeClient,
  youtubeChannelId: string,
  stop?: Stop,
  options?: { comments?: boolean; uploadSample?: number },
): Promise<SpokenLanguageRead> {
  const empty = {
    language: null,
    conclusive: false,
    countries: null,
    averageViews: null,
    lastActiveAt: null,
    publishesLongForm: null,
    publishesShorts: null,
  };
  if (stop) await stop();
  const [channel] = await client.listChannels([youtubeChannelId]);
  if (!channel) return empty;
  if (stop) await stop();
  const sample = options?.uploadSample ?? UPLOAD_SAMPLE;
  const uploads = channel.uploadsPlaylistId ? await client.listUploads(channel.uploadsPlaylistId, sample) : [];
  if (stop) await stop();
  const details = uploads.length ? await client.listVideos(uploads.map((item) => item.videoId)) : [];
  const posts = details.map((video) => ({
    id: video.id,
    title: video.title,
    description: video.description,
    creatorComments: [] as string[],
    about: false,
  }));
  if (channel.description.trim()) {
    posts.push({ id: "", title: "", description: channel.description, creatorComments: [], about: true });
  }
  if (options?.comments !== false) {
    let fetched = 0;
    for (const post of posts) {
      if (stop) await stop();
      if (!post.id || fetched >= CREATOR_COMMENT_VIDEOS) break;
      post.creatorComments = await client.listCommentTexts(post.id);
      fetched += 1;
    }
  }
  const read = channelLanguageRead(posts);
  const countries = readContentCountries(posts);
  const activity = selectRecentPublicVideos(details);
  return {
    language: read.language,
    conclusive: read.conclusive,
    countries: contentCountryList(countries.countries) ?? (countries.conclusive ? "" : null),
    averageViews: activity.averageViews,
    lastActiveAt: activity.lastActiveAt,
    publishesLongForm: activity.publishesLongForm,
    publishesShorts: activity.publishesShorts,
  };
}

/**
 * Keeps catalog channels whose texts use a requested language, and stores that
 * reading. A finished read that finds no language clears the old value, so a
 * language YouTube declared is not offered again. A quota stop leaves the rest
 * unlinked and unchanged.
 */
export async function confirmSpokenCreatorIds(
  client: YouTubeClient,
  ids: string[],
  languages: string[],
  stop?: Stop,
  maxReads = STORED_REREAD_LIMIT,
): Promise<string[]> {
  if (!isSpecificLanguageChoice(languages) || ids.length === 0) return ids;
  const rows = await prisma.creator.findMany({
    where: { id: { in: ids } },
    select: { id: true, youtubeChannelId: true, language: true, languageCheckedAt: true, languageReadVersion: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept: string[] = [];
  let reads = 0;
  for (const id of ids) {
    if (stop) await stop();
    const row = byId.get(id);
    if (!row?.youtubeChannelId) continue;
    if (row.languageCheckedAt && row.languageReadVersion >= LANGUAGE_READ_VERSION) {
      if (storedLanguageCovers(row.language, languages)) kept.push(id);
      continue;
    }
    if (reads >= maxReads) continue;
    reads += 1;
    try {
      const spoken = await readSpokenLanguage(client, row.youtubeChannelId, stop);
      await prisma.creator.update({
        where: { id },
        data: {
          language: spoken.language,
          ...(spoken.conclusive ? { languageCheckedAt: new Date(), languageReadVersion: LANGUAGE_READ_VERSION } : {}),
          ...(spoken.countries != null ? { contentCountries: spoken.countries } : {}),
        },
      });
      if (storedLanguageCovers(spoken.language, languages)) kept.push(id);
    } catch (error) {
      if (error instanceof JobCancelled) throw error;
      if (error instanceof YouTubeApiError && error.code === "QUOTA") break;
    }
  }
  return kept;
}

/** Channels already read that are not in this country. The next search does not fetch them again. */
export async function skipSettledCountryMisses(skip: Set<string>, countries: string[]): Promise<void> {
  const wanted = countries.map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code));
  if (wanted.length === 0) return;
  const rows = await prisma.creator.findMany({
    where: {
      hidden: false,
      contentCountries: { not: null },
      NOT: {
        OR: [
          { country: { in: wanted } },
          ...statedCountryClauses(wanted),
        ],
      },
    },
    select: { youtubeChannelId: true },
    take: 4000,
  });
  for (const row of rows) {
    if (row.youtubeChannelId) skip.add(row.youtubeChannelId);
  }
}

/** Channels already read that do not speak this language. The next search does not fetch them again. */
export async function skipSettledLanguageMisses(skip: Set<string>, languages: string[]): Promise<void> {
  const filter = languageReuseFilter(languages);
  if (!filter) return;
  const rows = await prisma.creator.findMany({
    where: { hidden: false, languageCheckedAt: { not: null }, NOT: filter },
    select: { youtubeChannelId: true },
    take: 4000,
  });
  for (const row of rows) {
    if (row.youtubeChannelId) skip.add(row.youtubeChannelId);
  }
}
