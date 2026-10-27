import { timingSafeEqual } from "crypto";
import type { EmailContact } from "@prisma/client";
import { ApiError } from "@/lib/authz";
import { pickPrimaryEmail } from "@/lib/creators/email";

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? "";
}

export function assertWayoAdsKey(provided: string) {
  const expected = process.env.WAYO_ADS_API_KEY?.trim() ?? "";
  if (!expected) throw new ApiError(503, "WAYO_ADS_API_KEY is not configured.");
  if (!provided || !keysMatch(provided, expected)) throw new ApiError(401, "Invalid API key");
}

type PublicEmail = Pick<EmailContact, "emailAddress" | "sourceType" | "sourceUrl" | "verificationStatus" | "isGenericInbox" | "confidenceStatus">;

function publicEmail(email: PublicEmail) {
  return {
    address: email.emailAddress,
    sourceType: email.sourceType,
    sourceUrl: email.sourceUrl,
    verificationStatus: email.verificationStatus,
    isGenericInbox: email.isGenericInbox,
  };
}

export function toWayoAdsCreator<T extends {
  id: string;
  youtubeChannelId: string;
  channelName: string;
  channelHandle: string | null;
  channelUrl: string;
  description: string | null;
  country: string | null;
  keywords: string[];
  subscriberCount: number | null;
  subscriberVisibility: string;
  videoCount: number | null;
  viewCount: bigint | null;
  thumbnailUrl: string | null;
  averageViews: number | null;
  lastActiveAt: Date | null;
  officialWebsiteUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  tiktokUrl: string | null;
  matchedVideoTitle: string | null;
  matchedVideoUrl: string | null;
  matchedVideoViews: number | null;
  matchedVideoPublishedAt: Date | null;
  emails: PublicEmail[];
}>(creator: T) {
  const email = pickPrimaryEmail(creator.emails);
  if (!email) return null;
  return {
    id: creator.id,
    youtubeChannelId: creator.youtubeChannelId,
    channelName: creator.channelName,
    channelHandle: creator.channelHandle,
    channelUrl: creator.channelUrl,
    description: creator.description,
    country: creator.country,
    keywords: creator.keywords,
    subscriberCount: creator.subscriberCount,
    subscriberVisibility: creator.subscriberVisibility,
    videoCount: creator.videoCount,
    viewCount: creator.viewCount?.toString() ?? null,
    thumbnailUrl: creator.thumbnailUrl,
    averageViews: creator.averageViews,
    lastActiveAt: creator.lastActiveAt?.toISOString() ?? null,
    officialWebsiteUrl: creator.officialWebsiteUrl,
    instagramUrl: creator.instagramUrl,
    twitterUrl: creator.twitterUrl,
    tiktokUrl: creator.tiktokUrl,
    matchedVideoTitle: creator.matchedVideoTitle,
    matchedVideoUrl: creator.matchedVideoUrl,
    matchedVideoViews: creator.matchedVideoViews,
    matchedVideoPublishedAt: creator.matchedVideoPublishedAt?.toISOString() ?? null,
    email: publicEmail(email),
    emails: creator.emails.map(publicEmail),
  };
}

function keysMatch(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
