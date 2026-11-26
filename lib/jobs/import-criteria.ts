import type { YouTubeClient } from "@/lib/youtube/client";
import { readRecentPublicVideos } from "@/lib/icp/domain-types";
import { readSpokenLanguage, type SpokenLanguageRead } from "@/lib/icp/confirm-spoken";
import { prisma } from "@/lib/db";
import { AVERAGE_VIEWS_METHOD } from "@/lib/youtube/metrics";
import { LANGUAGE_READ_VERSION } from "@/lib/youtube/spoken-language";

const STATS_SAMPLE = 50;

export type StoredMatchCriteria = {
  languageCheckedAt: Date | null;
  languageReadVersion: number;
  averageViews: number | null;
  lastActiveAt: Date | null;
  recentPublicVideos: unknown;
  publishesLongForm: boolean | null;
  publishesShorts: boolean | null;
};

/** A stored channel still needs one YouTube read before matching can use it. */
export function needsMatchRead(creator: StoredMatchCriteria | null): boolean {
  if (!creator) return true;
  const languageDue = creator.languageCheckedAt == null || creator.languageReadVersion < LANGUAGE_READ_VERSION;
  const viewsDue = creator.averageViews == null || creator.lastActiveAt == null;
  const videosDue = readRecentPublicVideos(creator.recentPublicVideos).length === 0;
  const formatDue = creator.publishesLongForm == null && creator.publishesShorts == null;
  return languageDue || viewsDue || videosDue || formatDue;
}

/** Fields a spoken-language read can fill. Null when the read found nothing worth storing. */
export function matchCriteriaPatch(spoken: SpokenLanguageRead, languageDue: boolean) {
  const published = spoken.lastActiveAt ? new Date(spoken.lastActiveAt) : null;
  const lastActiveAt = published && !Number.isNaN(published.getTime()) ? published : null;
  const formats = spoken.publishesLongForm != null || spoken.publishesShorts != null
    ? {
        ...(spoken.publishesLongForm != null ? { publishesLongForm: spoken.publishesLongForm } : {}),
        ...(spoken.publishesShorts != null ? { publishesShorts: spoken.publishesShorts } : {}),
      }
    : null;
  const languageSettled = languageDue && spoken.conclusive;
  const activity = spoken.averageViews != null || Boolean(lastActiveAt) || Boolean(formats) || spoken.recentPublicVideos.length > 0;
  if (!languageSettled && !activity) return null;
  return {
    ...(languageSettled
      ? {
          language: spoken.language,
          languageCheckedAt: new Date(),
          languageReadVersion: LANGUAGE_READ_VERSION,
          ...(spoken.countries != null ? { contentCountries: spoken.countries } : {}),
        }
      : {}),
    ...(spoken.averageViews != null
      ? { averageViews: spoken.averageViews, averageViewsMethod: AVERAGE_VIEWS_METHOD }
      : {}),
    ...(lastActiveAt ? { lastActiveAt, recentVideoPublishedAt: lastActiveAt } : {}),
    ...(formats ?? {}),
    ...(spoken.recentPublicVideos.length ? { recentPublicVideos: spoken.recentPublicVideos } : {}),
  };
}

/**
 * Reads a channel once when language, views, format, or recent videos are missing.
 * A channel whose language is already current is read without comments.
 */
export async function fillMissingMatchCriteria(
  client: YouTubeClient,
  creatorId: string,
  youtubeChannelId: string,
  stored: StoredMatchCriteria | null,
) {
  if (!needsMatchRead(stored)) return;
  const languageDue = stored == null || stored.languageCheckedAt == null || stored.languageReadVersion < LANGUAGE_READ_VERSION;
  const spoken = await readSpokenLanguage(
    client,
    youtubeChannelId,
    undefined,
    languageDue ? undefined : { comments: false, uploadSample: STATS_SAMPLE },
  );
  const data = matchCriteriaPatch(spoken, languageDue);
  if (!data) return;
  await prisma.creator.update({ where: { id: creatorId }, data });
}
