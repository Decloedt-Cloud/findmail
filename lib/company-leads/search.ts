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
};

function likePrefixes(prefixes: string[]): string[] {
  return [...new Set(prefixes.filter((prefix) => CODE.test(prefix)).map((prefix) => `${prefix}%`))].slice(0, 12);
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
  id, "businessName", domain, email, "sicName", "mailingCity" AS city, "mailingState" AS state
`;

async function sicPrefixHits(pattern: string, take: number): Promise<CompanyLeadHit[]> {
  return prisma.$queryRaw<CompanyLeadHit[]>`
    SELECT ${COLUMNS}
    FROM company_leads
    WHERE "sicCode" LIKE ${pattern}
    ORDER BY "sicCode", id
    LIMIT ${take}
  `;
}

async function naicsPrefixHits(pattern: string, take: number): Promise<CompanyLeadHit[]> {
  return prisma.$queryRaw<CompanyLeadHit[]>`
    SELECT ${COLUMNS}
    FROM company_leads
    WHERE "naicsCode" LIKE ${pattern}
    ORDER BY "naicsCode", id
    LIMIT ${take}
  `;
}

async function nameHits(patterns: string[], take: number, excludeIds: string[]): Promise<CompanyLeadHit[]> {
  const excludeSql = excludeIds.length
    ? Prisma.sql`AND NOT (id = ANY(${excludeIds}::text[]))`
    : Prisma.empty;
  return prisma.$queryRaw<CompanyLeadHit[]>`
    SELECT ${COLUMNS}
    FROM company_leads
    WHERE "sicName" ILIKE ANY(${patterns}::text[])
    ${excludeSql}
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
}): Promise<CompanyLeadHit[]> {
  const sic = likePrefixes(input.sicPrefixes);
  const naics = likePrefixes(input.naicsPrefixes);
  const exclude = input.excludeIds.filter((id) => /^[a-z0-9]{8,40}$/i.test(id)).slice(0, 200);
  const perPrefix = 40;
  const seenIds = new Set<string>(exclude);
  const seenDomains = new Set<string>();
  const hits: CompanyLeadHit[] = [];

  const branches = [
    ...sic.map((pattern) => sicPrefixHits(pattern, perPrefix)),
    ...naics.map((pattern) => naicsPrefixHits(pattern, perPrefix)),
  ];
  if (branches.length) {
    const batches = await Promise.all(branches);
    for (const batch of batches) {
      hits.push(...dedupe(batch, input.limit - hits.length, seenIds, seenDomains));
      if (hits.length >= input.limit) return hits.slice(0, input.limit);
    }
  }

  const words = ilikeWords(input.keywords);
  if (words.length && hits.length < 24) {
    const extra = await nameHits(words, 200, [...seenIds]);
    hits.push(...dedupe(extra, input.limit - hits.length, seenIds, seenDomains));
  }

  return hits.slice(0, input.limit);
}
