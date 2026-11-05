import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { toWayoAdsCompanyLeadTeaser } from "@/lib/company-leads/serialize";
import { prisma } from "@/lib/db";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsCompanyLeadSampleQuerySchema } from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:company-leads-sample", 60, 60 * 1000);

    const url = new URL(request.url);
    const input = wayoAdsCompanyLeadSampleQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const where = { domain: { not: null } };
    const total = await prisma.companyLead.count({ where });
    const window = Math.max(input.limit * 8, 64);
    const skip = total > window ? Math.floor(Math.random() * (total - window)) : 0;

    const rows = await prisma.companyLead.findMany({
      where,
      skip,
      take: window,
      orderBy: { id: "asc" },
      select: { businessName: true, sicName: true, domain: true },
    });

    // Shuffle then keep unique domains up to limit.
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = rows[i];
      rows[i] = rows[j];
      rows[j] = swap;
    }

    const leads: ReturnType<typeof toWayoAdsCompanyLeadTeaser>[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const domain = row.domain?.trim().toLowerCase();
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      leads.push(toWayoAdsCompanyLeadTeaser(row));
      if (leads.length >= input.limit) break;
    }

    return NextResponse.json({ leads });
  } catch (error) {
    return jsonError(error);
  }
}
