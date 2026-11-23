import "../lib/load-env";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { createYouTubeClient } from "../lib/youtube/client";

// Usage: npx tsx scripts/backfill-channel-details.ts
// Fills thumbnailUrl and channelHandle for CSV-imported creators that are missing them.
// One channels.list call (1 unit) covers up to 50 channels.
const BATCH = 50;

async function main() {
  const creators = await prisma.creator.findMany({
    where: {
      discoverySource: "CSV_IMPORT",
      OR: [{ thumbnailUrl: null }, { channelHandle: null }],
    },
    select: { id: true, youtubeChannelId: true, thumbnailUrl: true, channelHandle: true },
  });
  console.log(`${creators.length} creator(s) missing a thumbnail or handle`);
  if (creators.length === 0) return;

  const client = createYouTubeClient(fetch, async (units, operation, success, message) => {
    await prisma.apiUsage.create({ data: { provider: "youtube", operation, units, success, message } });
  });

  let updated = 0;
  let notFound = 0;
  for (let i = 0; i < creators.length; i += BATCH) {
    const batch = creators.slice(i, i + BATCH);
    const channels = new Map((await client.listChannels(batch.map((c) => c.youtubeChannelId))).map((ch) => [ch.id, ch]));
    for (const creator of batch) {
      const channel = channels.get(creator.youtubeChannelId);
      if (!channel) {
        notFound += 1;
        continue;
      }
      const data: Prisma.CreatorUpdateInput = {};
      if (!creator.thumbnailUrl && channel.thumbnailUrl) data.thumbnailUrl = channel.thumbnailUrl;
      if (!creator.channelHandle && channel.customUrl) data.channelHandle = channel.customUrl;
      if (Object.keys(data).length === 0) continue;
      await prisma.creator.update({ where: { id: creator.id }, data });
      updated += 1;
    }
    console.log(`progress ${Math.min(i + BATCH, creators.length)}/${creators.length}`);
  }
  console.log(`done: ${updated} updated, ${notFound} channel(s) not returned by YouTube`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "backfill failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
