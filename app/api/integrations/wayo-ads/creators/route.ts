import { NextResponse } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertWayoAdsKey, bearerToken, toWayoAdsCreator } from "@/lib/integrations/wayo-ads";
import { wayoAdsCreatorQuerySchema } from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:creators", 60, 60 * 1000);
    const url = new URL(request.url);
    const input = wayoAdsCreatorQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
      niche: url.searchParams.get("niche") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    const where = {
      hidden: false,
      emails: { some: {} },
      ...(input.country ? { country: input.country.toUpperCase() } : {}),
      ...(input.niche ? { niche: { equals: input.niche, mode: "insensitive" as const } } : {}),
      ...(input.q
        ? {
            OR: [
              { channelName: { contains: input.q, mode: "insensitive" as const } },
              { channelHandle: { contains: input.q, mode: "insensitive" as const } },
              { niche: { contains: input.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.creator.count({ where }),
      prisma.creator.findMany({
        where,
        orderBy: [{ subscriberCount: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          youtubeChannelId: true,
          channelName: true,
          channelHandle: true,
          channelUrl: true,
          description: true,
          country: true,
          niche: true,
          keywords: true,
          subscriberCount: true,
          subscriberVisibility: true,
          videoCount: true,
          viewCount: true,
          thumbnailUrl: true,
          averageViews: true,
          lastActiveAt: true,
          officialWebsiteUrl: true,
          instagramUrl: true,
          twitterUrl: true,
          tiktokUrl: true,
          matchedVideoTitle: true,
          matchedVideoUrl: true,
          matchedVideoViews: true,
          matchedVideoPublishedAt: true,
          emails: {
            select: {
              emailAddress: true,
              sourceType: true,
              sourceUrl: true,
              verificationStatus: true,
              isGenericInbox: true,
              confidenceStatus: true,
            },
          },
        },
      }),
    ]);
    const creators = rows.flatMap((row) => {
      const creator = toWayoAdsCreator(row);
      return creator ? [creator] : [];
    });
    return NextResponse.json(creators, {
      headers: {
        "X-Total-Count": String(total),
        "X-Page": String(input.page),
        "X-Page-Size": String(input.pageSize),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
