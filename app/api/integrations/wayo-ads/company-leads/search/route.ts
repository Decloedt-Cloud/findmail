import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { countCompanyLeads, searchCompanyLeads } from "@/lib/company-leads/search";
import { toWayoAdsCompanyLead } from "@/lib/company-leads/serialize";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsCompanyLeadSearchSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:company-leads-search", 60, 60 * 1000);

    const body = wayoAdsCompanyLeadSearchSchema.parse(await request.json());
    const query = {
      keywords: body.keywords,
      sicPrefixes: body.sicPrefixes,
      naicsPrefixes: body.naicsPrefixes,
      bands: body.bands,
    };

    const [hits, total] = await Promise.all([
      searchCompanyLeads({
        ...query,
        limit: body.limit,
        excludeIds: body.excludeIds,
      }),
      body.includeTotal ? countCompanyLeads(query) : Promise.resolve(null),
    ]);

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
          employeeCount: row.employeeCount,
          salesVolume: row.salesVolume,
          employeeBand: row.employeeBand,
          revenueBand: row.revenueBand,
        }),
      ),
      ...(total == null ? {} : { total }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
