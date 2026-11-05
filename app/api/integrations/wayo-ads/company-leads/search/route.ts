import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { PREFILTER_SELECT, toWayoAdsCompanyLead } from "@/lib/company-leads/serialize";
import { prisma } from "@/lib/db";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsCompanyLeadSearchSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:company-leads-search", 60, 60 * 1000);

    const body = wayoAdsCompanyLeadSearchSchema.parse(await request.json());
    const keywords = body.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 20);
    const excludeIds = body.excludeIds;
    const limit = body.limit;

    let hits: Array<{
      id: string;
      businessName: string;
      domain: string | null;
      email: string;
      sicName: string | null;
      mailingCity: string | null;
      mailingState: string | null;
    }> = [];

    if (keywords.length > 0) {
      const orClauses: Prisma.CompanyLeadWhereInput[] = keywords.map((kw) => ({
        sicName: { contains: kw, mode: "insensitive" },
      }));
      hits = await prisma.companyLead.findMany({
        where: {
          OR: orClauses,
          ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
        },
        take: limit,
        orderBy: { id: "asc" },
        select: PREFILTER_SELECT,
      });
    }

    if (hits.length >= 24 || keywords.length === 0) {
      if (keywords.length === 0) {
        hits = await sampleLeads(limit, excludeIds);
      }
      return NextResponse.json({ leads: hits.map(toWayoAdsCompanyLead) });
    }

    const exclude = [...excludeIds, ...hits.map((h) => h.id)];
    const extra = await sampleLeads(limit - hits.length, exclude);
    return NextResponse.json({
      leads: [...hits, ...extra].map(toWayoAdsCompanyLead),
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function sampleLeads(take: number, excludeIds: string[]) {
  if (take <= 0) return [];
  return prisma.companyLead.findMany({
    where: excludeIds.length ? { id: { notIn: excludeIds } } : undefined,
    take,
    orderBy: { id: "asc" },
    select: PREFILTER_SELECT,
  });
}
