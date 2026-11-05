import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const CODE = /^\d{2,6}$/;

export type CompanyLeadHit = {
  id: string;
  businessName: string;
  domain: string | null;
  email: string;
  sicName: string | null;
  city: string | null;
  state: string | null;
  employeeCount: string | null;
  salesVolume: string | null;
  employeeBand: number | null;
  revenueBand: number | null;
};

function likePrefixes(prefixes: string[]): string[] {
  const unique = [...new Set(prefixes.filter((prefix) => CODE.test(prefix)))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  const kept: string[] = [];
  for (const prefix of unique) {
    if (kept.some((shorter) => prefix.startsWith(shorter))) continue;
    kept.push(prefix);
    if (kept.length >= 8) break;
  }
  return kept.map((prefix) => `${prefix}%`);
}

function ilikeWords(keywords: string[]): string[] {
  const out: string[] = [];
  for (const raw of keywords) {
    const word = raw.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (word.length < 4 || word.length > 40) continue;
    if (!out.includes(`%${word}%`)) out.push(`%${word}%`);
    if (out.length >= 6) break;
  }
  return out;
}

const COLUMNS = Prisma.sql`
  id, "businessName", domain, email, "sicName", "mailingCity" AS city, "mailingState" AS state,
  "employeeCount", "salesVolume", "employeeBand", "revenueBand"
`;

/**
 * Keep only rows whose size band is in `bands`.
 *
 * A company is as big as its larger dimension — headcount says whether a
 * marketing team exists, revenue says whether they can fund a collaboration.
 * Rows with no parseable size at all are never excluded: "unknown" is not "small".
 */
function bandFilter(bands: number[]): Prisma.Sql {
  const valid = [...new Set(bands.filter((b) => Number.isInteger(b) && b >= 0 && b <= 3))].sort();
  if (valid.length === 0 || valid.length === 4) return Prisma.empty;
  return Prisma.sql`AND (
    ("employeeBand" IS NULL AND "revenueBand" IS NULL)
    OR GREATEST(COALESCE("employeeBand", 0), COALESCE("revenueBand", 0)) = ANY(${valid}::int[])
  )`;
}

async function sicPrefixHits(pattern: string, take: number, bands: number[]): Promise<CompanyLeadHit[]> {
  return prisma.$queryRaw<CompanyLeadHit[]>`
    SELECT ${COLUMNS}
    FROM company_leads
    WHERE "sicCode" LIKE ${pattern}
    ${bandFilter(bands)}
    LIMIT ${take}
  `;
}

async function naicsPrefixHits(pattern: string, take: number, bands: number[]): Promise<CompanyLeadHit[]> {
  return prisma.$queryRaw<CompanyLeadHit[]>`
    SELECT ${COLUMNS}
    FROM company_leads
    WHERE "naicsCode" LIKE ${pattern}
    ${bandFilter(bands)}
    LIMIT ${take}
  `;
}

async function nameHits(
  patterns: string[],
  take: number,
  excludeIds: string[],
  bands: number[],
): Promise<CompanyLeadHit[]> {
  const excludeSql = excludeIds.length
    ? Prisma.sql`AND NOT (id = ANY(${excludeIds}::text[]))`
    : Prisma.empty;
  return prisma.$queryRaw<CompanyLeadHit[]>`
    SELECT ${COLUMNS}
    FROM company_leads
    WHERE "sicName" ILIKE ANY(${patterns}::text[])
    ${excludeSql}
    ${bandFilter(bands)}
    LIMIT ${take}
  `;
}

function dedupe(rows: CompanyLeadHit[], limit: number, seenIds: Set<string>, seenDomains: Set<string>): CompanyLeadHit[] {
  const out: CompanyLeadHit[] = [];
  for (const row of rows) {
    if (seenIds.has(row.id)) continue;
    const domain = row.domain?.trim().toLowerCase() || "";
    if (domain && seenDomains.has(domain)) continue;
    seenIds.add(row.id);
    if (domain) seenDomains.add(domain);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * One contact per domain. SIC/NAICS prefixes hit the btree and stop early.
 * SIC name fragments are a short trigram fallback.
 */
export async function searchCompanyLeads(input: {
  keywords: string[];
  sicPrefixes: string[];
  naicsPrefixes: string[];
  limit: number;
  excludeIds: string[];
  bands?: number[];
}): Promise<CompanyLeadHit[]> {
  const sic = likePrefixes(input.sicPrefixes);
  const naics = likePrefixes(input.naicsPrefixes);
  const bands = input.bands ?? [];
  const exclude = input.excludeIds.filter((id) => /^[a-z0-9]{8,40}$/i.test(id)).slice(0, 200);
  const perPrefix = 40;
  const seenIds = new Set<string>(exclude);
  const seenDomains = new Set<string>();
  const hits: CompanyLeadHit[] = [];

  const scans: Array<[string[], (pattern: string, take: number, bands: number[]) => Promise<CompanyLeadHit[]>]> = [
    [sic, sicPrefixHits],
    [naics, naicsPrefixHits],
  ];
  for (const [patterns, query] of scans) {
    for (const pattern of patterns) {
      if (hits.length >= input.limit) return hits.slice(0, input.limit);
      const batch = await query(pattern, perPrefix, bands);
      hits.push(...dedupe(batch, input.limit - hits.length, seenIds, seenDomains));
    }
  }

  const words = ilikeWords(input.keywords);
  if (words.length && hits.length < 24) {
    const extra = await nameHits(words, 200, [...seenIds], bands);
    hits.push(...dedupe(extra, input.limit - hits.length, seenIds, seenDomains));
  }

  return hits.slice(0, input.limit);
}

/**
 * How many companies exist in this window (any SIC/NAICS/name match).
 * Used by the blurred teaser so it promises a real number, not a hash.
 */
export async function countCompanyLeads(input: {
  keywords: string[];
  sicPrefixes: string[];
  naicsPrefixes: string[];
  bands?: number[];
}): Promise<number> {
  const sic = likePrefixes(input.sicPrefixes);
  const naics = likePrefixes(input.naicsPrefixes);
  const words = ilikeWords(input.keywords);
  const bands = input.bands ?? [];

  const matches: Prisma.Sql[] = [];
  if (sic.length) matches.push(Prisma.sql`"sicCode" LIKE ANY(${sic}::text[])`);
  if (naics.length) matches.push(Prisma.sql`"naicsCode" LIKE ANY(${naics}::text[])`);
  if (words.length) matches.push(Prisma.sql`"sicName" ILIKE ANY(${words}::text[])`);

  // No niche signal (guest teaser before the ICP exists): the band window alone
  // is the honest answer, not zero.
  const anyMatch =
    matches.length === 0
      ? Prisma.sql`TRUE`
      : matches.reduce(
          (acc, part, i) => (i === 0 ? Prisma.sql`(${part})` : Prisma.sql`${acc} OR (${part})`),
          Prisma.empty,
        );

  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total
    FROM company_leads
    WHERE (${anyMatch})
    ${bandFilter(bands)}
  `;
  const total = rows[0]?.total;
  return total == null ? 0 : Number(total);
}
