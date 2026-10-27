import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, readJson } from "@/lib/api";
import { acceptWayoIcp } from "@/lib/icp/accept";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsIcpSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:icp", 20, 60 * 1000);
    const input = wayoAdsIcpSchema.parse(await readJson(request));
    const result = await acceptWayoIcp(input);
    return NextResponse.json(result, { status: result.queued ? 202 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}
