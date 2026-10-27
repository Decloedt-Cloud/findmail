import { prisma } from "@/lib/db";

type CountRow = { count: number };
type DayRow = { day: Date; count: number };
type LabelRow = { label: string; count: number };
type RangeRow = {
  unknown: number;
  under_1k: number;
  from_1k: number;
  from_10k: number;
  from_50k: number;
  from_100k: number;
  from_1m: number;
};

function num(value: unknown) {
  return Number(value ?? 0);
}

export async function analyticsOverview() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    totalCreators,
    uniqueEmailRows,
    creatorsWithEmail,
    unverified,
    verified,
    duplicates,
    activeJobs,
    creatorsPerDay,
    emailsPerDay,
    countries,
    ranges,
    sources,
    recentJobs,
    latestCreators,
    recentExports,
  ] = await Promise.all([
    prisma.creator.count({ where: { hidden: false } }),
    prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(DISTINCT e."normalizedEmail")::int AS count
      FROM "EmailContact" e
      INNER JOIN "Creator" c ON c.id = e."creatorId"
      WHERE c.hidden = false
    `,
    prisma.creator.count({ where: { hidden: false, emails: { some: {} } } }),
    prisma.emailContact.count({
      where: {
        creator: { hidden: false },
        verificationStatus: { in: ["DISCOVERED", "SYNTAX_VALID", "UNKNOWN", "NEEDS_REVIEW"] },
      },
    }),
    prisma.emailContact.count({ where: { creator: { hidden: false }, verificationStatus: "VERIFIED" } }),
    prisma.dedupEvent.count(),
    prisma.processingJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.$queryRaw<DayRow[]>`
      SELECT date_trunc('day', "discoveredAt") AS day, COUNT(*)::int AS count
      FROM "Creator"
      WHERE hidden = false AND "discoveredAt" >= ${since}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<DayRow[]>`
      SELECT date_trunc('day', e."discoveredAt") AS day, COUNT(*)::int AS count
      FROM "EmailContact" e
      INNER JOIN "Creator" c ON c.id = e."creatorId"
      WHERE c.hidden = false AND e."discoveredAt" >= ${since}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<LabelRow[]>`
      SELECT COALESCE(NULLIF(country, ''), 'Not provided') AS label, COUNT(*)::int AS count
      FROM "Creator" WHERE hidden = false
      GROUP BY 1 ORDER BY count DESC LIMIT 12
    `,
    prisma.$queryRaw<RangeRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "subscriberVisibility" <> 'PUBLIC' OR "subscriberCount" IS NULL)::int AS unknown,
        COUNT(*) FILTER (WHERE "subscriberVisibility" = 'PUBLIC' AND "subscriberCount" < 1000)::int AS under_1k,
        COUNT(*) FILTER (WHERE "subscriberVisibility" = 'PUBLIC' AND "subscriberCount" BETWEEN 1000 AND 9999)::int AS from_1k,
        COUNT(*) FILTER (WHERE "subscriberVisibility" = 'PUBLIC' AND "subscriberCount" BETWEEN 10000 AND 49999)::int AS from_10k,
        COUNT(*) FILTER (WHERE "subscriberVisibility" = 'PUBLIC' AND "subscriberCount" BETWEEN 50000 AND 99999)::int AS from_50k,
        COUNT(*) FILTER (WHERE "subscriberVisibility" = 'PUBLIC' AND "subscriberCount" BETWEEN 100000 AND 999999)::int AS from_100k,
        COUNT(*) FILTER (WHERE "subscriberVisibility" = 'PUBLIC' AND "subscriberCount" >= 1000000)::int AS from_1m
      FROM "Creator" WHERE hidden = false
    `,
    prisma.$queryRaw<LabelRow[]>`
      SELECT "discoverySource"::text AS label, COUNT(*)::int AS count
      FROM "Creator" WHERE hidden = false GROUP BY 1 ORDER BY count DESC
    `,
    prisma.processingJob.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.creator.findMany({
      where: { hidden: false },
      orderBy: { discoveredAt: "desc" },
      take: 6,
      include: { emails: { take: 1, orderBy: { discoveredAt: "desc" } } },
    }),
    prisma.exportRecord.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
  ]);

  const range = ranges[0];
  return {
    cards: {
      totalCreators,
      uniqueEmails: num(uniqueEmailRows[0]?.count),
      creatorsWithEmail,
      emailsUnverified: unverified,
      emailsVerified: verified,
      creatorsWithoutEmail: totalCreators - creatorsWithEmail,
      duplicatesPrevented: duplicates,
      activeJobs,
    },
    creatorsPerDay: creatorsPerDay.map((row) => ({ date: row.day.toISOString().slice(0, 10), count: num(row.count) })),
    emailsPerDay: emailsPerDay.map((row) => ({ date: row.day.toISOString().slice(0, 10), count: num(row.count) })),
    creatorsByCountry: countries.map((row) => ({ country: row.label, count: num(row.count) })),
    subscriberRanges: [
      { range: "Not public", count: num(range?.unknown) },
      { range: "Under 1K", count: num(range?.under_1k) },
      { range: "1K–10K", count: num(range?.from_1k) },
      { range: "10K–50K", count: num(range?.from_10k) },
      { range: "50K–100K", count: num(range?.from_50k) },
      { range: "100K–1M", count: num(range?.from_100k) },
      { range: "1M+", count: num(range?.from_1m) },
    ],
    sources: sources.map((row) => ({ source: row.label, count: num(row.count) })),
    recentJobs,
    latestCreators: latestCreators.map((creator) => ({
      ...creator,
      viewCount: creator.viewCount?.toString() ?? null,
    })),
    recentExports,
  };
}
