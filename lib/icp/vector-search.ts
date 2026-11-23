import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import {
  channelEmbeddingText,
  embedText,
  embeddingContentHash,
  EMBED_DIMS,
} from "@/lib/icp/embed";
import { activeSince } from "@/lib/youtube/qualify";

const VECTOR_LIMIT = 40;

export function vectorLiteral(vector: number[]): Prisma.Sql {
  const body = vector
    .slice(0, EMBED_DIMS)
    .map((value) => (Number.isFinite(value) ? value.toFixed(8) : "0"))
    .join(",");
  return Prisma.raw(`'[${body}]'::vector`);
}

function countryCodes(codes: string[]): string[] {
  return codes
    .map((code) => code.trim().toUpperCase())
    .filter((code, index, list) => /^[A-Z]{2}$/.test(code) && list.indexOf(code) === index);
}

function languageCodes(codes: string[]): string[] {
  return codes
    .map((code) => code.trim().toLowerCase())
    .filter((code, index, list) => /^[a-z]{2,8}$/.test(code) && list.indexOf(code) === index);
}

function catalogWhere(input: {
  countries: string[];
  languages: string[];
  excludeCreatorIds: string[];
  requireRecentActivity: boolean;
  model?: string;
}): Prisma.Sql {
  const countries = countryCodes(input.countries);
  const languages = languageCodes(input.languages);
  const excluded = input.excludeCreatorIds.filter(Boolean);
  const countrySql = countries.length
    ? Prisma.sql`c.country IN (${Prisma.join(countries)})`
    : Prisma.sql`FALSE`;
  const languageSql = languages.length
    ? Prisma.sql`(
        c.language IS NULL OR c.language = ''
        OR lower(c.language) IN (${Prisma.join(languages)})
        OR lower(c.language) LIKE ANY (${Prisma.sql`ARRAY[${Prisma.join(languages.map((code) => `${code}-%`))}]`})
      )`
    : Prisma.sql`TRUE`;
  const excludedSql = excluded.length
    ? Prisma.sql`c.id NOT IN (${Prisma.join(excluded)})`
    : Prisma.sql`TRUE`;
  const activitySql = input.requireRecentActivity
    ? Prisma.sql`c."lastActiveAt" >= ${activeSince()} AND c."averageViews" IS NOT NULL`
    : Prisma.sql`TRUE`;
  const modelSql = input.model
    ? Prisma.sql`c.embedding IS NOT NULL AND c."embeddingModel" = ${input.model}`
    : Prisma.sql`c.embedding IS NOT NULL`;
  return Prisma.sql`
    c.hidden = false
    AND c."subscriberVisibility" = 'PUBLIC'::"SubscriberVisibility"
    AND c."subscriberCount" >= ${ICP_MIN_SUBSCRIBERS}
    AND c."subscriberCount" <= ${ICP_MAX_SUBSCRIBERS}
    AND c."channelIcp" IS NOT NULL
    AND ${countrySql}
    AND ${languageSql}
    AND ${excludedSql}
    AND ${activitySql}
    AND ${modelSql}
    AND (
      EXISTS (
        SELECT 1 FROM "EmailContact" email
        WHERE email."creatorId" = c.id
          AND email."emailAddress" <> ''
          AND email."verificationStatus" NOT IN (
            'INVALID'::"EmailVerificationStatus",
            'NOT_FOUND'::"EmailVerificationStatus"
          )
      )
      OR (c."instagramUrl" IS NOT NULL AND c."instagramUrl" <> '')
      OR (c."twitterUrl" IS NOT NULL AND c."twitterUrl" <> '')
      OR (c."tiktokUrl" IS NOT NULL AND c."tiktokUrl" <> '')
    )
  `;
}

export type VectorLookup =
  | { status: "hits"; ids: string[] }
  | { status: "none" }
  | { status: "unavailable" };

/**
 * Nearest stored channels for one ICP vector.
 * `unavailable` means the index could not be queried, so the caller may scan.
 * `none` means vectors exist for this filter and none were returned.
 */
export async function nearestStoredCreatorIds(input: {
  vector: number[];
  model: string;
  countries: string[];
  languages: string[];
  excludeCreatorIds: string[];
  requireRecentActivity: boolean;
  limit?: number;
}): Promise<VectorLookup> {
  const where = catalogWhere({ ...input, model: input.model });
  const limit = input.limit ?? VECTOR_LIMIT;
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT c.id
      FROM "Creator" c
      WHERE ${where}
      ORDER BY c.embedding <=> ${vectorLiteral(input.vector)}
      LIMIT ${limit}
    `);
    if (rows.length > 0) return { status: "hits", ids: rows.map((row) => row.id) };
    const present = await prisma.$queryRaw<{ found: boolean }[]>(Prisma.sql`
      SELECT EXISTS(
        SELECT 1 FROM "Creator" c
        WHERE ${where}
      ) AS found
    `);
    return present[0]?.found ? { status: "none" } : { status: "unavailable" };
  } catch (error) {
    logger.warn("icp vector search unavailable", {
      message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return { status: "unavailable" };
  }
}

/** One vector write. The literal is a bound parameter so it cannot be spliced into the SQL. */
export async function writeCreatorEmbedding(input: {
  creatorId: string;
  vector: number[];
  model: string;
  hash: string;
}): Promise<void> {
  const literal = `[${input.vector
    .slice(0, EMBED_DIMS)
    .map((value) => (Number.isFinite(value) ? value.toFixed(8) : "0"))
    .join(",")}]`;
  await prisma.$executeRaw`
    UPDATE "Creator"
    SET embedding = CAST(${literal} AS vector),
        "embeddingModel" = ${input.model},
        "embeddingHash" = ${input.hash}
    WHERE id = ${input.creatorId}
  `;
}

/** Write the channel vector when its text changed. A failure leaves the previous vector in place. */
export async function rememberCreatorEmbedding(creatorId: string): Promise<void> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      channelName: true,
      description: true,
      keywords: true,
      channelIcp: true,
      embeddingModel: true,
      embeddingHash: true,
    },
  });
  if (!creator) return;
  const text = channelEmbeddingText(creator);
  const embedded = await embedText(text);
  const hash = embeddingContentHash(embedded.model, text);
  if (creator.embeddingModel === embedded.model && creator.embeddingHash === hash) return;
  await writeCreatorEmbedding({
    creatorId,
    vector: embedded.vector,
    model: embedded.model,
    hash,
  });
}
