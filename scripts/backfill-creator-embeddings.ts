import { prisma } from "@/lib/db";
import { channelEmbeddingText, embedTexts, embeddingContentHash, preferredEmbedModel } from "@/lib/icp/embed";
import { vectorLiteral } from "@/lib/icp/vector-search";

const rebuild = process.argv.includes("--rebuild");
const model = preferredEmbedModel();

async function main() {
  const creators = await prisma.creator.findMany({
    where: rebuild ? {} : { OR: [{ embeddingHash: null }, { embeddingModel: null }] },
    select: {
      id: true,
      channelName: true,
      description: true,
      keywords: true,
      channelIcp: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`${creators.length} channel(s) to embed (${model})`);
  let saved = 0;
  for (let index = 0; index < creators.length; index += 16) {
    const slice = creators.slice(index, index + 16);
    const texts = slice.map((creator) => channelEmbeddingText(creator));
    const embedded = await embedTexts(texts);
    for (let row = 0; row < slice.length; row += 1) {
      const creator = slice[row];
      const vector = embedded.vectors[row];
      if (!vector) continue;
      const hash = embeddingContentHash(embedded.model, texts[row]);
      await prisma.$executeRaw`
        UPDATE "Creator"
        SET embedding = ${vectorLiteral(vector)},
            "embeddingModel" = ${embedded.model},
            "embeddingHash" = ${hash}
        WHERE id = ${creator.id}
      `;
      saved += 1;
    }
    console.log(`progress ${Math.min(index + slice.length, creators.length)}/${creators.length}`);
  }
  console.log(`done: ${saved} saved`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "backfill failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
