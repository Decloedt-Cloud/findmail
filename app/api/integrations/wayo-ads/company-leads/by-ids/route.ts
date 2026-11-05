import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { PREFILTER_SELECT, toWayoAdsCompanyLead } from "@/lib/company-leads/serialize";
import { prisma } from "@/lib/db";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsCompanyLeadByIdsSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:company-leads-by-ids", 60, 60 * 1000);

    const body = wayoAdsCompanyLeadByIdsSchema.parse(await request.json());
    const rows = await prisma.companyLead.findMany({
      where: { id: { in: body.ids } },
      select: PREFILTER_SELECT,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = body.ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return NextResponse.json({ leads: ordered.map(toWayoAdsCompanyLead) });
  } catch (error) {
    return jsonError(error);
  }
}
