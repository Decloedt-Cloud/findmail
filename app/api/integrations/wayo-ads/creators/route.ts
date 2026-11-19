import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { enforceRateLimit, jsonError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertWayoAdsKey, bearerToken, toWayoAdsCreator } from "@/lib/integrations/wayo-ads";
import { ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { wayoAdsCreatorQuerySchema } from "@/lib/schemas";

const UNUSABLE_EMAIL = ["INVALID", "NOT_FOUND"] as const;

export async function GET(request: Request) {
  try {
    assertWayoAdsKey(bearerToken(request));
    await enforceRateLimit("wayo-ads:creators", 60, 60 * 1000);
    const url = new URL(request.url);
    const input = wayoAdsCreatorQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      ids: url.searchParams.get("ids") ?? undefined,
    });
    const ids = (input.ids ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && id.length <= 80)
      .slice(0, 40);
    const where: Prisma.CreatorWhereInput = ids.length
      ? {
          OR: [{ id: { in: ids } }, { youtubeChannelId: { in: ids } }],
          emails: {
            some: {
              verificationStatus: { notIn: [...UNUSABLE_EMAIL] },
              emailAddress: { not: "" },
            },
          },
        }
      : {
      hidden: false,
      subscriberVisibility: "PUBLIC",
      subscriberCount: { gte: ICP_MIN_SUBSCRIBERS },
      // Catalog rows must have a usable public email (INVALID / blank do not count).
      emails: {
        some: {
          verificationStatus: { notIn: [...UNUSABLE_EMAIL] },
          emailAddress: { not: "" },
        },
      },
      ...(input.country ? { country: input.country.toUpperCase() } : {}),
      ...(input.q
        ? {
            OR: [
              { channelName: { contains: input.q, mode: "insensitive" } },
              { channelHandle: { contains: input.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await prisma.$transaction([
      prisma.creator.count({ where }),
      prisma.creator.findMany({
        where,
        orderBy: [{ subscriberCount: { sort: "desc", nulls: "last" } }, { discoveredAt: "desc" }],
        skip: ids.length ? 0 : (input.page - 1) * input.pageSize,
        take: ids.length ? ids.length : input.pageSize,
        select: {
          id: true,
          youtubeChannelId: true,
          channelName: true,
          channelHandle: true,
          channelUrl: true,
          description: true,
          country: true,
          language: true,
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
