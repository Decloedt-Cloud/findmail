import "../lib/load-env";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { writeChannelIcp } from "../lib/icp/channel-icp";
import { createYouTubeClient, type YouTubeChannel } from "../lib/youtube/client";

// Usage: npx tsx scripts/backfill-channel-icp.ts [limit]
// Computes the channel ICP for CSV-imported creators that do not have one yet.
const limit = Number(process.argv[2] || 0) || undefined;
const CONCURRENCY = 4;
const BATCH = 50;

async function main() {
  const creators = await prisma.creator.findMany({
    where: { discoverySource: "CSV_IMPORT", channelIcp: { equals: Prisma.DbNull } },
    select: { id: true, youtubeChannelId: true, channelName: true, description: true, country: true },
    orderBy: { discoveredAt: "asc" },
    take: limit,
  });
  console.log(`${creators.length} creator(s) without channel ICP`);
  if (creators.length === 0) return;

  const client = createYouTubeClient(fetch, async (units, operation, success, message) => {
    await prisma.apiUsage.create({ data: { provider: "youtube", operation, units, success, message } });
  });

  // One channels.list call (1 unit) covers up to 50 channels.
  const details = new Map<string, YouTubeChannel>();
  for (let i = 0; i < creators.length; i += BATCH) {
    const ids = creators.slice(i, i + BATCH).map((creator) => creator.youtubeChannelId);
    for (const channel of await client.listChannels(ids)) details.set(channel.id, channel);
  }
  console.log(`YouTube details loaded for ${details.size}/${creators.length} channel(s)`);

  let done = 0;
  let fallback = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < creators.length) {
      const creator = creators[cursor++];
      const channel = details.get(creator.youtubeChannelId);
      const source = {
        id: creator.youtubeChannelId,
        title: channel?.title || creator.channelName,
        description: channel?.description || creator.description || "",
        keywords: channel?.keywords ?? [],
        country: channel?.country || creator.country,
      };
      try {
        const profile = await writeChannelIcp(source);
        // The fallback profile is named "<title> viewers"; count it so we know whether DeepSeek answered.
        if (profile.name === `${source.title} viewers`.slice(0, 120)) fallback += 1;
        await prisma.creator.update({
          where: { id: creator.id },
          data: {
            channelIcp: profile,
            ...(creator.description ? {} : { description: source.description || null }),
          },
        });
      } catch (error) {
        failed += 1;
        console.error(`failed ${creator.youtubeChannelId}: ${error instanceof Error ? error.message : "unknown"}`);
      }
      done += 1;
      if (done % 25 === 0 || done === creators.length) {
        console.log(`progress ${done}/${creators.length} (fallback ${fallback}, failed ${failed})`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`done: ${done - failed} saved, ${fallback} used fallback, ${failed} failed`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "backfill failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
