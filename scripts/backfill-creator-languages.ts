import { Prisma } from "@prisma/client";
import "../lib/load-env";
import { prisma } from "../lib/db";
import { readSpokenLanguage, type SpokenLanguageRead } from "../lib/icp/confirm-spoken";
import { AVERAGE_VIEWS_METHOD } from "../lib/youtube/metrics";
import { LANGUAGE_READ_VERSION } from "../lib/youtube/spoken-language";
import { createYouTubeClient, YouTubeApiError } from "../lib/youtube/client";
import { youtubeQuotaDayStart } from "../lib/youtube/quota-day";

// Usage: npm run db:backfill-languages -- 20
//        npm run db:backfill-languages -- 46 videos
//        npx tsx scripts/backfill-creator-languages.ts --limit=20
// The daily cron sets YOUTUBE_BACKFILL_QUOTA. That caps this script's own YouTube units
// for the current quota day and leaves the rest of YOUTUBE_DAILY_QUOTA for other work.
// One read fills a missing language and, from the same videos, average views, the last public video, the format, and recent titles.
// A channel whose language is already current is read without comments. A short empty language read stays pending.
// `videos` reads only channels that already have a language and views but no stored recent videos.

const MAX_LOT = 200;

const languagePending = {
  OR: [{ languageCheckedAt: null }, { languageReadVersion: { lt: LANGUAGE_READ_VERSION } }],
};

const viewsPending = {
  OR: [{ averageViews: null }, { lastActiveAt: null }],
};

const videosPending = {
  languageCheckedAt: { not: null },
  languageReadVersion: { gte: LANGUAGE_READ_VERSION },
  averageViews: { not: null },
  lastActiveAt: { not: null },
  recentPublicVideos: { equals: Prisma.DbNull },
};

const pendingWhere = {
  hidden: false,
  OR: [languagePending, viewsPending, videosPending],
};

const STATS_SAMPLE = 50;

function activityData(spoken: SpokenLanguageRead) {
  const published = spoken.lastActiveAt ? new Date(spoken.lastActiveAt) : null;
  const lastActiveAt = published && !Number.isNaN(published.getTime()) ? published : null;
  const formats = spoken.publishesLongForm != null || spoken.publishesShorts != null
    ? {
        ...(spoken.publishesLongForm != null ? { publishesLongForm: spoken.publishesLongForm } : {}),
        ...(spoken.publishesShorts != null ? { publishesShorts: spoken.publishesShorts } : {}),
      }
    : null;
  if (spoken.averageViews == null && !lastActiveAt && !formats && spoken.recentPublicVideos.length === 0) return null;
  return {
    ...(spoken.averageViews != null
      ? { averageViews: spoken.averageViews, averageViewsMethod: AVERAGE_VIEWS_METHOD }
      : {}),
    ...(lastActiveAt ? { lastActiveAt, recentVideoPublishedAt: lastActiveAt } : {}),
    ...(formats ?? {}),
    ...(spoken.recentPublicVideos.length ? { recentPublicVideos: spoken.recentPublicVideos } : {}),
  };
}

function takeLimit(): number {
  const flagged = process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
  const bare = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
  const parsed = Number(flagged ?? bare);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function videosOnly(): boolean {
  return process.argv.includes("videos");
}

function quotaError(error: unknown): boolean {
  return error instanceof YouTubeApiError && error.code === "QUOTA";
}

const BACKFILL_MARK = "language-backfill";

async function openClient() {
  const daily = Number(process.env.YOUTUBE_DAILY_QUOTA || 10000);
  const backfillBudget = Number(process.env.YOUTUBE_BACKFILL_QUOTA || 0);
  const since = youtubeQuotaDayStart();
  const used = await prisma.apiUsage.aggregate({
    _sum: { units: true },
    where: { provider: "youtube", createdAt: { gte: since } },
  });
  const backfill = backfillBudget > 0
    ? await prisma.apiUsage.aggregate({
        _sum: { units: true },
        where: {
          provider: "youtube",
          createdAt: { gte: since },
          message: { startsWith: BACKFILL_MARK },
        },
      })
    : null;
  let consumed = used._sum.units ?? 0;
  let backfillUsed = backfill?._sum.units ?? 0;
  if (backfillBudget > 0) {
    console.log(`backfill budget: ${backfillUsed}/${backfillBudget} since ${since.toISOString()}`);
  }
  return createYouTubeClient(
    fetch,
    async (units, operation, success, message) => {
      consumed += units;
      if (backfillBudget > 0) backfillUsed += units;
      const note = backfillBudget > 0 ? [BACKFILL_MARK, message].filter(Boolean).join(" ") : message;
      await prisma.apiUsage.create({
        data: { provider: "youtube", operation, units, success, message: note?.slice(0, 300) },
      });
    },
    (units) => {
      if (backfillBudget > 0 && backfillUsed + units > backfillBudget) {
        throw new YouTubeApiError("The language backfill has reached its YouTube quota for this period.", "QUOTA");
      }
      if (consumed + units > daily) {
        throw new YouTubeApiError("The daily YouTube quota budget would be exceeded by the next request.", "QUOTA");
      }
    },
  );
}

async function main() {
  const requested = takeLimit();
  if (requested === 0 || requested > MAX_LOT) {
    console.error(`Usage: npm run db:backfill-languages -- <lot>`);
    console.error(`The lot is a number from 1 to ${MAX_LOT}.`);
    process.exitCode = 1;
    return;
  }

  const onlyVideos = videosOnly();
  const scope = onlyVideos ? { hidden: false, ...videosPending } : pendingWhere;
  const before = await prisma.creator.count({ where: scope });
  const languageRows = onlyVideos
    ? []
    : await prisma.creator.findMany({
        where: { hidden: false, ...languagePending },
        orderBy: [{ languageReadVersion: "asc" }, { id: "asc" }],
        take: requested,
        select: { id: true, youtubeChannelId: true, languageCheckedAt: true, languageReadVersion: true },
      });
  const viewRows = !onlyVideos && languageRows.length < requested
    ? await prisma.creator.findMany({
        where: {
          hidden: false,
          languageCheckedAt: { not: null },
          languageReadVersion: { gte: LANGUAGE_READ_VERSION },
          ...viewsPending,
          ...(languageRows.length > 0 ? { id: { notIn: languageRows.map((row) => row.id) } } : {}),
        },
        orderBy: { id: "asc" },
        take: requested - languageRows.length,
        select: { id: true, youtubeChannelId: true, languageCheckedAt: true, languageReadVersion: true },
      })
    : [];
  const taken = [...languageRows, ...viewRows];
  const videoRows = taken.length < requested
    ? await prisma.creator.findMany({
        where: {
          hidden: false,
          ...videosPending,
          ...(taken.length > 0 ? { id: { notIn: taken.map((row) => row.id) } } : {}),
        },
        orderBy: { id: "asc" },
        take: requested - taken.length,
        select: { id: true, youtubeChannelId: true, languageCheckedAt: true, languageReadVersion: true },
      })
    : [];
  const rows = [...taken, ...videoRows];
  const waiting = onlyVideos ? "recent videos" : "a language, views, or recent videos";
  console.log(
    `reading ${rows.length} of ${before} channel(s) waiting for ${waiting} (${languageRows.length} language, ${viewRows.length} views, ${videoRows.length} videos)`,
  );
  if (rows.length === 0) {
    console.log("updated: 0");
    console.log("remaining: 0");
    return;
  }

  const client = await openClient();
  let updated = 0;
  let held = 0;
  let skipped = 0;
  let stopped = false;
  for (const [index, row] of rows.entries()) {
    if (stopped) break;
    const languageDue = row.languageCheckedAt == null || row.languageReadVersion < LANGUAGE_READ_VERSION;
    try {
      const spoken = await readSpokenLanguage(
        client,
        row.youtubeChannelId,
        undefined,
        languageDue ? undefined : { comments: false, uploadSample: STATS_SAMPLE },
      );
      const activity = activityData(spoken);
      const languageSettled = languageDue && spoken.conclusive;
      if (!languageSettled && !activity) {
        held += 1;
        console.log(`${index + 1}/${rows.length} ${row.youtubeChannelId} held`);
        continue;
      }
      await prisma.creator.update({
        where: { id: row.id },
        data: {
          ...(languageSettled
            ? {
                language: spoken.language,
                languageCheckedAt: new Date(),
                languageReadVersion: LANGUAGE_READ_VERSION,
                ...(spoken.countries != null ? { contentCountries: spoken.countries } : {}),
              }
            : {}),
          ...(activity ?? {}),
        },
      });
      updated += 1;
      if (languageDue && !spoken.conclusive) held += 1;
      const languageLabel = languageSettled ? spoken.language || "none" : languageDue ? "language held" : "language kept";
      const viewsLabel = spoken.averageViews != null || spoken.lastActiveAt ? "views" : "views held";
      const formatLabel = spoken.publishesLongForm != null || spoken.publishesShorts != null ? "format" : "format held";
      const videosLabel = spoken.recentPublicVideos.length ? "videos" : "videos held";
      if (!languageDue && spoken.recentPublicVideos.length === 0) held += 1;
      console.log(`${index + 1}/${rows.length} ${row.youtubeChannelId} ${languageLabel}, ${viewsLabel}, ${formatLabel}, ${videosLabel}`);
    } catch (error) {
      if (quotaError(error)) {
        stopped = true;
        break;
      }
      skipped += 1;
      console.error(`${row.youtubeChannelId} skipped`);
    }
  }

  const remaining = await prisma.creator.count({ where: scope });
  if (stopped) console.log("stopped: YouTube quota reached. Wait until the quota resets, then run the script again.");
  console.log(`updated: ${updated}`);
  if (held > 0) console.log(`held: ${held}`);
  if (skipped > 0) console.log(`skipped: ${skipped}`);
  console.log(`remaining: ${remaining}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "backfill failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
