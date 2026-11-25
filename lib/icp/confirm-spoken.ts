import { prisma } from "@/lib/db";
import { YouTubeApiError, type YouTubeClient } from "@/lib/youtube/client";
import { contentCountryList, readContentCountries, storedCountriesCover } from "@/lib/youtube/content-country";
import { languageReuseFilter, statedCountryClauses } from "@/lib/icp/reuse";
import { channelLanguageRead, isSpecificLanguageChoice, LANGUAGE_READ_VERSION, storedLanguageCovers } from "@/lib/youtube/spoken-language";

const CREATOR_COMMENT_VIDEOS = 30;
const UPLOAD_SAMPLE = 200;

/**
 * Finishes an older read for channels this request already shows.
 * A quota stop leaves the rest for the next search instead of failing this one.
 */
export async function refreshUncheckedLanguages(
  client: YouTubeClient,
  ids: string[],
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
    if (!row.youtubeChannelId) continue;
    try {
      const spoken = await readSpokenLanguage(client, row.youtubeChannelId);
      await prisma.creator.update({
        where: { id: row.id },
        data: {
          language: spoken.language,
          ...(spoken.conclusive ? { languageCheckedAt: new Date(), languageReadVersion: LANGUAGE_READ_VERSION } : {}),
          ...(spoken.countries != null ? { contentCountries: spoken.countries } : {}),
        },
      });
    } catch (error) {
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
): Promise<string[]> {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const rows = await prisma.creator.findMany({
    where: {
      languageCheckedAt: null,
      OR: [{ language: null }, { language: "" }],
      lastMetadataSyncAt: { gte: since },
      hidden: false,
    },
    orderBy: { lastMetadataSyncAt: "desc" },
    take: 40,
    select: {
      id: true,
      youtubeChannelId: true,
      country: true,
      discoveryRegion: true,
      contentCountries: true,
    },
  });
  const wanted = countries.map((code) => code.toUpperCase());
  const kept: string[] = [];
  for (const row of rows) {
    if (!row.youtubeChannelId || skipYoutubeIds.has(row.youtubeChannelId)) continue;
    try {
      const spoken = await readSpokenLanguage(client, row.youtubeChannelId);
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
      if (error instanceof YouTubeApiError && error.code === "QUOTA") break;
    }
  }
  return kept;
}

/** Language and stated country of one stored channel. */
export async function readSpokenLanguage(
  client: YouTubeClient,
  youtubeChannelId: string,
): Promise<{ language: string | null; conclusive: boolean; countries: string | null }> {
  const [channel] = await client.listChannels([youtubeChannelId]);
  if (!channel) return { language: null, conclusive: false, countries: null };
  const uploads = channel.uploadsPlaylistId ? await client.listUploads(channel.uploadsPlaylistId, UPLOAD_SAMPLE) : [];
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
  let fetched = 0;
  for (const post of posts) {
    if (!post.id || fetched >= CREATOR_COMMENT_VIDEOS) break;
    post.creatorComments = await client.listCommentTexts(post.id);
    fetched += 1;
  }
  const read = channelLanguageRead(posts);
  const countries = readContentCountries(posts);
  return {
    language: read.language,
    conclusive: read.conclusive,
    countries: contentCountryList(countries.countries) ?? (countries.conclusive ? "" : null),
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
): Promise<string[]> {
  if (!isSpecificLanguageChoice(languages) || ids.length === 0) return ids;
  const rows = await prisma.creator.findMany({
    where: { id: { in: ids } },
    select: { id: true, youtubeChannelId: true, language: true, languageCheckedAt: true, languageReadVersion: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const kept: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row?.youtubeChannelId) continue;
    if (row.languageCheckedAt && row.languageReadVersion >= LANGUAGE_READ_VERSION) {
      if (storedLanguageCovers(row.language, languages)) kept.push(id);
      continue;
    }
    try {
      const spoken = await readSpokenLanguage(client, row.youtubeChannelId);
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
