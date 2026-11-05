import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { searchCompanyLeads } from "@/lib/company-leads/search";
import { toWayoAdsCompanyLead } from "@/lib/company-leads/serialize";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsCompanyLeadSearchSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:company-leads-search", 60, 60 * 1000);

    const body = wayoAdsCompanyLeadSearchSchema.parse(await request.json());
    const hits = await searchCompanyLeads({
      keywords: body.keywords,
      sicPrefixes: body.sicPrefixes,
      naicsPrefixes: body.naicsPrefixes,
      limit: body.limit,
      excludeIds: body.excludeIds,
    });

    return NextResponse.json({
      leads: hits.map((row) =>
        toWayoAdsCompanyLead({
          id: row.id,
          businessName: row.businessName,
          domain: row.domain,
          email: row.email,
          sicName: row.sicName,
          mailingCity: row.city,
          mailingState: row.state,
        }),
      ),
    });
  } catch (error) {
    return jsonError(error);
  }
}
