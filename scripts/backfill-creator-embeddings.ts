import { prisma } from "@/lib/db";
import { channelEmbeddingText, embedTexts, embeddingContentHash, preferredEmbedModel } from "@/lib/icp/embed";
import { writeCreatorEmbedding } from "@/lib/icp/vector-search";

const rebuild = process.argv.includes("--rebuild");
const model = preferredEmbedModel();

async function main() {
  const creators = await prisma.creator.findMany({
    where: rebuild ? {} : { OR: [{ embeddingHash: null }, { embeddingModel: null }] },
    select: {
      id: true,
      youtubeChannelId: true,
      channelName: true,
      description: true,
      keywords: true,
      channelIcp: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`${creators.length} channel(s) to embed (${model})`);
  let saved = 0;
  let skipped = 0;
  for (let index = 0; index < creators.length; index += 16) {
    const slice = creators.slice(index, index + 16);
    const texts = slice.map((creator) => channelEmbeddingText(creator));
    const embedded = await embedTexts(texts);
    for (let row = 0; row < slice.length; row += 1) {
      const creator = slice[row];
      const vector = embedded.vectors[row];
      if (!vector) continue;
      const hash = embeddingContentHash(embedded.model, texts[row]);
      try {
        await writeCreatorEmbedding({
          creatorId: creator.id,
          vector,
          model: embedded.model,
          hash,
        });
        saved += 1;
      } catch (error) {
        skipped += 1;
        const message = error instanceof Error ? error.message.split("\n")[0] : "unknown";
        console.error(`skipped ${creator.youtubeChannelId}: ${message}`);
      }
    }
    console.log(`progress ${Math.min(index + slice.length, creators.length)}/${creators.length}`);
  }
  console.log(`done: ${saved} saved, ${skipped} skipped`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "backfill failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
