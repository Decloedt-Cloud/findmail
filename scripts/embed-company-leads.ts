/**
 * One embedding per company domain (not per contact). Resumable.
 *
 *   npm run embed:company-leads
 */
import "../lib/load-env";
import { embedTexts, embeddingConfigured, toVectorLiteral } from "../lib/company-leads/embed";
import { prisma } from "../lib/db";

const BATCH = 64;

type Pending = {
  domain: string;
  businessName: string;
  sicName: string | null;
};

async function nextBatch(): Promise<Pending[]> {
  return prisma.$queryRaw<Pending[]>`
    SELECT DISTINCT ON (lower(l.domain))
      lower(l.domain) AS domain,
      l."businessName" AS "businessName",
      l."sicName" AS "sicName"
    FROM company_leads l
    LEFT JOIN company_lead_vectors v ON v.domain = lower(l.domain)
    WHERE l.domain IS NOT NULL
      AND v.domain IS NULL
    ORDER BY lower(l.domain)
    LIMIT ${BATCH}
  `;
}

function lineFor(row: Pending): string {
  return [row.businessName, row.sicName, row.domain].filter(Boolean).join(" · ").slice(0, 500);
}

async function main() {
  if (!embeddingConfigured()) {
    console.error("Set EMBEDDING_API_KEY (OpenAI-compatible). DeepSeek does not embed.");
    process.exit(1);
  }

  let inserted = 0;
  for (;;) {
    const batch = await nextBatch();
    if (batch.length === 0) break;
    const vectors = await embedTexts(batch.map(lineFor));
    if (!vectors) throw new Error("Embedding response was empty");
    for (let i = 0; i < batch.length; i += 1) {
      const row = batch[i];
      const literal = toVectorLiteral(vectors[i]);
      await prisma.$executeRaw`
        INSERT INTO company_lead_vectors (domain, sic_name, embedding)
        VALUES (${row.domain}, ${row.sicName}, ${literal}::vector)
        ON CONFLICT (domain) DO NOTHING
      `;
    }
    inserted += batch.length;
    if (inserted % 640 === 0) console.log(`embedded ${inserted}`);
  }

  const total = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM company_lead_vectors
  `;
  console.log("Done", { inserted, vectors: Number(total[0]?.count ?? 0) });
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
