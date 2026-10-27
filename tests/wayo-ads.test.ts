import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/authz";
import { assertWayoAdsKey, bearerToken, toWayoAdsCreator } from "@/lib/integrations/wayo-ads";

const creator = {
  id: "c1",
  youtubeChannelId: "UC1",
  channelName: "Ada",
  channelHandle: "@ada",
  channelUrl: "https://www.youtube.com/channel/UC1",
  description: "Public channel description",
  country: "FR",
  keywords: ["business"],
  subscriberCount: 1200,
  subscriberVisibility: "PUBLIC",
  videoCount: 12,
  viewCount: BigInt(3400),
  thumbnailUrl: "https://img.test/ada.jpg",
  averageViews: 400,
  lastActiveAt: new Date("2026-10-01T00:00:00Z"),
  officialWebsiteUrl: "https://ada.test",
  instagramUrl: null,
  twitterUrl: null,
  tiktokUrl: null,
  matchedVideoTitle: "A public video",
  matchedVideoUrl: "https://www.youtube.com/watch?v=vid1",
  matchedVideoViews: 80,
  matchedVideoPublishedAt: new Date("2026-09-01T00:00:00Z"),
  emails: [
    {
      emailAddress: "info@ada.test",
      sourceType: "CHANNEL_DESCRIPTION" as const,
      sourceUrl: "https://www.youtube.com/channel/UC1",
      verificationStatus: "VERIFIED" as const,
      isGenericInbox: true,
      confidenceStatus: "HIGH" as const,
    },
    {
      emailAddress: "ada@ada.test",
      sourceType: "CHANNEL_DESCRIPTION" as const,
      sourceUrl: "https://www.youtube.com/channel/UC1",
      verificationStatus: "SYNTAX_VALID" as const,
      isGenericInbox: false,
      confidenceStatus: "MEDIUM" as const,
    },
  ],
};

describe("Wayo Ads creator payload", () => {
  it("reads a bearer token and rejects a missing or wrong key", () => {
    expect(bearerToken(new Request("http://localhost", { headers: { authorization: "Bearer secret-key" } }))).toBe("secret-key");
    expect(bearerToken(new Request("http://localhost"))).toBe("");
    const previous = process.env.WAYO_ADS_API_KEY;
    process.env.WAYO_ADS_API_KEY = "secret-key";
    expect(() => assertWayoAdsKey("secret-key")).not.toThrow();
    expect(() => assertWayoAdsKey("other-key")).toThrow(ApiError);
    delete process.env.WAYO_ADS_API_KEY;
    expect(() => assertWayoAdsKey("secret-key")).toThrow(ApiError);
    if (previous === undefined) delete process.env.WAYO_ADS_API_KEY;
    else process.env.WAYO_ADS_API_KEY = previous;
  });

  it("puts the named public email on the creator and skips a creator with no email", () => {
    const payload = toWayoAdsCreator(creator);
    expect(payload?.email.address).toBe("ada@ada.test");
    expect(payload?.emails).toHaveLength(2);
    expect(payload?.description).toBe("Public channel description");
    expect(payload?.viewCount).toBe("3400");
    expect(payload?.country).toBe("FR");
    expect(payload?.lastActiveAt).toBe("2026-10-01T00:00:00.000Z");
    expect(toWayoAdsCreator({ ...creator, emails: [] })).toBeNull();
  });
});
