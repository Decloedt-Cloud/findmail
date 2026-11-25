import "../lib/load-env";
import { prisma } from "../lib/db";
import { createYouTubeClient, YouTubeApiError, type YouTubeVideoDetails } from "../lib/youtube/client";
import { selectRecentPublicVideos } from "../lib/youtube/metrics";

// Usage: npx tsx scripts/backfill-creator-formats.ts
//        npx tsx scripts/backfill-creator-formats.ts --limit=200
// Fills publishesLongForm and publishesShorts from the 10 newest uploads.
// Rows already measured are skipped. A second run continues after a quota stop.
const BATCH = 50;
const UPLOADS = 10;

function takeLimit(): number {
  const raw = process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function quotaError(error: unknown): boolean {
  return error instanceof YouTubeApiError && error.code === "QUOTA";
}

async function main() {
  const limit = takeLimit();
  const creators = await prisma.creator.findMany({
    where: { publishesLongForm: null, publishesShorts: null },
    select: { id: true, youtubeChannelId: true },
    orderBy: { discoveredAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`${creators.length} creator(s) without a measured format`);
  if (creators.length === 0) return;

  const client = createYouTubeClient(fetch, async (units, operation, success, message) => {
    await prisma.apiUsage.create({ data: { provider: "youtube", operation, units, success, message } });
  });

  let updated = 0;
  let skipped = 0;
  let stopped = false;
  for (let index = 0; index < creators.length && !stopped; index += BATCH) {
    const batch = creators.slice(index, index + BATCH);
    let channels;
    try {
      channels = await client.listChannels(batch.map((row) => row.youtubeChannelId));
    } catch (error) {
      if (quotaError(error)) {
        stopped = true;
        break;
      }
      throw error;
    }
    const byChannel = new Map(channels.map((channel) => [channel.id, channel]));
    const uploads = new Map<string, string[]>();
    for (const creator of batch) {
      const playlistId = byChannel.get(creator.youtubeChannelId)?.uploadsPlaylistId;
      if (!playlistId) {
        skipped += 1;
        continue;
      }
      try {
        const items = await client.listUploads(playlistId, UPLOADS);
        uploads.set(creator.id, items.map((item) => item.videoId));
      } catch (error) {
        if (quotaError(error)) {
          stopped = true;
          break;
        }
        skipped += 1;
      }
    }
    const details = new Map<string, YouTubeVideoDetails>();
    const videoIds = [...new Set([...uploads.values()].flat())];
    try {
      for (let videoIndex = 0; videoIndex < videoIds.length; videoIndex += 50) {
        const videos = await client.listVideos(videoIds.slice(videoIndex, videoIndex + 50));
        for (const video of videos) details.set(video.id, video);
      }
    } catch (error) {
      if (quotaError(error)) {
        stopped = true;
        break;
      }
      throw error;
    }
    for (const creator of batch) {
      const ids = uploads.get(creator.id);
      if (!ids) continue;
      const videos = ids
        .map((id) => details.get(id))
        .filter((video): video is YouTubeVideoDetails => Boolean(video));
      const activity = selectRecentPublicVideos(videos);
      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          publishesLongForm: activity.publishesLongForm === true,
          publishesShorts: activity.publishesShorts === true,
        },
      });
      updated += 1;
    }
    console.log(`progress ${Math.min(index + BATCH, creators.length)}/${creators.length}`);
  }
  if (stopped) console.log("stopped: YouTube quota reached. Run the script again to continue.");
  console.log(`done: ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "backfill failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
