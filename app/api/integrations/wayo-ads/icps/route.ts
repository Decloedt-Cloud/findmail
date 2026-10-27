import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError, readJson } from "@/lib/api";
import { acceptWayoIcp } from "@/lib/icp/accept";
import { listWayoIcpMatches } from "@/lib/icp/wayo-matches";
import { assertWayoAdsKey, bearerToken } from "@/lib/integrations/wayo-ads";
import { wayoAdsIcpMatchQuerySchema, wayoAdsIcpSchema } from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:icp-read", 60, 60 * 1000);
    const url = new URL(request.url);
    const input = wayoAdsIcpMatchQuerySchema.parse({
      onboardingId: url.searchParams.get("onboardingId") ?? undefined,
      requestId: url.searchParams.get("requestId") ?? undefined,
    });
    const result = await listWayoIcpMatches(input);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

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
