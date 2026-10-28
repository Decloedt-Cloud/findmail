import { describe, expect, it, vi } from "vitest";
import { YouTubeClient } from "@/lib/youtube/client";
import { extractPublicContacts } from "@/lib/youtube/contacts";
import { discoverYouTubeChannels, isAutoTopicChannel, searchRelevance, topicTier } from "@/lib/youtube/discovery";
import { AVERAGE_VIEWS_METHOD, selectRecentPublicVideos } from "@/lib/youtube/metrics";
import type { YouTubeVideoDetails } from "@/lib/youtube/client";

function video(partial: Partial<YouTubeVideoDetails> & Pick<YouTubeVideoDetails, "id">): YouTubeVideoDetails {
  return {
    title: partial.id,
    description: "",
    publishedAt: "2026-01-01T00:00:00Z",
    viewCount: 10,
    privacyStatus: "public",
    liveBroadcastContent: "none",
    ...partial,
  };
}

describe("public description contacts", () => {
  it("keeps only emails and links written in the text", () => {
    const found = extractPublicContacts([
      "Business: ada@brand.test Site https://brand.test IG https://www.instagram.com/ada/ X https://x.com/ada TikTok https://www.tiktok.com/@ada",
    ]);
    expect(found.email).toBe("ada@brand.test");
    expect(found.emails[0]?.sourceType).toBe("CHANNEL_DESCRIPTION");
    expect(found.emails[0]?.verificationStatus).toBe("SYNTAX_VALID");
    expect(found.website).toBe("https://brand.test");
    expect(found.instagram).toBe("https://www.instagram.com/ada");
    expect(found.twitter).toBe("https://x.com/ada");
    expect(found.tiktok).toBe("https://www.tiktok.com/@ada");
  });

  it("keeps a link hub when the description has no other site", () => {
    const found = extractPublicContacts(["Email ada@brand.test https://linktr.ee/ada"]);
    expect(found.email).toBe("ada@brand.test");
    expect(found.website).toBe("https://linktr.ee/ada");
    expect(found.instagram).toBeNull();
  });

  it("does not invent a contact from a handle or a missing field", () => {
    const found = extractPublicContacts(["Follow @ada on Instagram and email us."]);
    expect(found.email).toBeNull();
    expect(found.website).toBeNull();
    expect(found.instagram).toBeNull();
    expect(found.twitter).toBeNull();
    expect(found.tiktok).toBeNull();
  });
});

describe("average views selection", () => {
  it("averages the 10 newest public videos and ignores private or upcoming items", () => {
    const videos = [
      video({ id: "old", publishedAt: "2025-01-01T00:00:00Z", viewCount: 1 }),
      video({ id: "private", publishedAt: "2026-03-01T00:00:00Z", viewCount: 999, privacyStatus: "private" }),
      video({ id: "premiere", publishedAt: "2026-03-02T00:00:00Z", viewCount: 999, liveBroadcastContent: "upcoming" }),
      video({ id: "hidden-views", publishedAt: "2026-03-03T00:00:00Z", viewCount: null }),
      ...Array.from({ length: 10 }, (_, index) =>
        video({
          id: `v${index}`,
          publishedAt: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
          viewCount: (index + 1) * 100,
        }),
      ),
    ];
    const result = selectRecentPublicVideos(videos);
    expect(result.retained.map((item) => item.id)).toEqual(["v9", "v8", "v7", "v6", "v5", "v4", "v3", "v2", "v1", "v0"]);
    expect(result.averageViews).toBe(550);
    expect(result.lastActiveAt).toBe("2026-02-10T00:00:00Z");
    expect(AVERAGE_VIEWS_METHOD).toContain("10 newest");
    expect(AVERAGE_VIEWS_METHOD).toContain("playlistItems.list");
    expect(AVERAGE_VIEWS_METHOD).toContain("videos.list");
  });

  it("returns null when no public video has a view count", () => {
    expect(selectRecentPublicVideos([video({ id: "a", viewCount: null })])).toEqual({
      retained: [],
      averageViews: null,
      lastActiveAt: null,
    });
  });
});

const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

describe("discovery enrichment", () => {
  it("fills public fields from search, channels, uploads, and video statistics", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/search") && parsed.searchParams.get("type") === "video") {
        return json({
          items: [{
            id: { videoId: "vid1", channelId: "UC1" },
            snippet: { title: "Tool review", channelTitle: "Ada", description: "Short", publishedAt: "2026-01-15T00:00:00Z" },
          }],
        });
      }
      if (parsed.pathname.endsWith("/search")) {
        return json({ items: [{ id: { channelId: "UC1" }, snippet: { channelTitle: "Ada", description: "" } }] });
      }
      if (parsed.pathname.endsWith("/channels")) {
        return json({
          items: [{
            id: "UC1",
            snippet: { title: "Ada", customUrl: "@ada", description: "Mail ada@brand.test https://brand.test https://instagram.com/ada", country: "US" },
            statistics: { subscriberCount: "10", hiddenSubscriberCount: false, videoCount: "3", viewCount: "600" },
            contentDetails: { relatedPlaylists: { uploads: "UU1" } },
          }],
        });
      }
      if (parsed.pathname.endsWith("/playlistItems")) {
        return json({
          items: [
            { contentDetails: { videoId: "new", videoPublishedAt: recent } },
            { contentDetails: { videoId: "vid1", videoPublishedAt: "2026-01-15T00:00:00Z" } },
            { contentDetails: { videoId: "soon", videoPublishedAt: "2026-03-01T00:00:00Z" } },
          ],
        });
      }
      return json({
        items: [
          { id: "new", snippet: { title: "New", publishedAt: recent, liveBroadcastContent: "none" }, statistics: { viewCount: "300" }, status: { privacyStatus: "public" } },
          { id: "vid1", snippet: { title: "Tool review", description: "Full description", publishedAt: "2026-01-15T00:00:00Z", liveBroadcastContent: "none" }, statistics: { viewCount: "200" }, status: { privacyStatus: "public" } },
          { id: "soon", snippet: { title: "Soon", publishedAt: "2026-03-01T00:00:00Z", liveBroadcastContent: "upcoming" }, statistics: { viewCount: "1" }, status: { privacyStatus: "public" } },
        ],
      });
    });

    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["ada"],
      countries: ["US"],
      maxResults: 5,
    });
    const channel = result.channels[0];
    expect(channel?.title).toBe("Ada");
    expect(channel?.customUrl).toBe("@ada");
    expect(channel?.subscriberCount).toBe(10);
    expect(channel?.averageViews).toBe(250);
    expect(channel?.lastActiveAt).toBe(recent);
    expect(channel?.averageViewsMethod).toBe(AVERAGE_VIEWS_METHOD);
    expect(channel?.matchedVideo).toEqual({
      title: "Tool review",
      url: "https://www.youtube.com/watch?v=vid1",
      views: 200,
      publishedAt: "2026-01-15T00:00:00Z",
    });
    expect(channel?.descriptionEmails.map((email) => email.normalizedEmail)).toEqual(["ada@brand.test"]);
    expect(channel?.officialWebsiteUrl).toBe("https://brand.test");
    expect(channel?.instagramUrl).toBe("https://instagram.com/ada");
    expect(channel?.twitterUrl).toBeNull();
    expect(channel?.tiktokUrl).toBeNull();
    expect(fetchImpl.mock.calls.map((call) => new URL(String(call[0])).pathname)).toEqual([
      "/youtube/v3/search",
      "/youtube/v3/channels",
      "/youtube/v3/search",
      "/youtube/v3/playlistItems",
      "/youtube/v3/videos",
    ]);
  });

  it("pages past channels outside the subscriber range and keeps a public video email", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/search")) {
        if (!parsed.searchParams.get("pageToken")) {
          return json({
            nextPageToken: "p2",
            items: [{ id: { videoId: "big", channelId: "UCbig" }, snippet: { title: "Food tour", channelTitle: "Giant", description: "" } }],
          });
        }
        return json({
          items: [{ id: { videoId: "fit", channelId: "UCfit" }, snippet: { title: "Food at home", channelTitle: "Home Cook", description: "" } }],
        });
      }
      if (parsed.pathname.endsWith("/channels")) {
        const id = parsed.searchParams.get("id");
        if (id === "UCbig") {
          return json({
            items: [{ id: "UCbig", snippet: { title: "Giant", country: "US" }, statistics: { subscriberCount: "5000000", hiddenSubscriberCount: false } }],
          });
        }
        return json({
          items: [{
            id: "UCfit",
            snippet: { title: "Home Cook", country: "US" },
            statistics: { subscriberCount: "20000", hiddenSubscriberCount: false },
            contentDetails: { relatedPlaylists: { uploads: "UUfit" } },
          }],
        });
      }
      if (parsed.pathname.endsWith("/playlistItems")) {
        return json({ items: [{ contentDetails: { videoId: "fit", videoPublishedAt: recent } }] });
      }
      return json({
        items: [{
          id: "fit",
          snippet: { title: "Food at home", description: "Bookings cook@kitchen.test", publishedAt: recent, liveBroadcastContent: "none" },
          statistics: { viewCount: "2000" },
          status: { privacyStatus: "public" },
        }],
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Food"],
      countries: ["US"],
      maxResults: 1,
      maxSubscribers: 100000,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["UCfit"]);
    expect(result.channels[0]?.descriptionEmails[0]?.normalizedEmail).toBe("cook@kitchen.test");
    expect(result.channels[0]?.descriptionEmails[0]?.sourceType).toBe("PUBLIC_PAGE");
    expect(result.filteredOut).toBeGreaterThan(0);
  });

  it("drops auto-generated topic channels and ranks a name match first", async () => {
    expect(isAutoTopicChannel("MIKE DEAN - Topic")).toBe(true);
    expect(searchRelevance({ title: "SaaS Club", handle: "@saasclub", videoTitle: "Pricing", keywords: ["SaaS"], hasEmail: true }))
      .toBeGreaterThan(searchRelevance({ title: "ABC News", handle: "@abc", videoTitle: "What is SaaS?", keywords: ["SaaS"], hasEmail: true }));
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/search") && parsed.searchParams.get("type") === "video") {
        return json({
          items: [
            { id: { videoId: "t", channelId: "UCtopic" }, snippet: { title: "SaaS", channelTitle: "MIKE DEAN - Topic", description: "saas@topic.test" } },
            { id: { videoId: "n", channelId: "UCnews" }, snippet: { title: "What is SaaS?", channelTitle: "ABC News", description: "tips@abc.test" } },
            { id: { videoId: "s", channelId: "UCclub" }, snippet: { title: "Pricing", channelTitle: "SaaS Club", description: "hello@saasclub.test" } },
          ],
        });
      }
      if (parsed.pathname.endsWith("/search")) return json({ items: [] });
      if (parsed.pathname.endsWith("/channels")) {
        return json({
          items: [
            { id: "UCtopic", snippet: { title: "MIKE DEAN - Topic", description: "saas@topic.test", country: "US" }, statistics: { subscriberCount: "10", hiddenSubscriberCount: false } },
            { id: "UCnews", snippet: { title: "ABC News", description: "tips@abc.test", country: "US" }, statistics: { subscriberCount: "10", hiddenSubscriberCount: false } },
            { id: "UCclub", snippet: { title: "SaaS Club", customUrl: "@saasclub", description: "hello@saasclub.test", country: "US" }, statistics: { subscriberCount: "10", hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: "UUclub" } } },
          ],
        });
      }
      if (parsed.pathname.endsWith("/playlistItems")) {
        return json({ items: [{ contentDetails: { videoId: "s", videoPublishedAt: recent } }] });
      }
      if (parsed.pathname.endsWith("/videos")) {
        return json({
          items: [{
            id: "s",
            snippet: { title: "Pricing", publishedAt: recent, liveBroadcastContent: "none" },
            statistics: { viewCount: "100" },
            status: { privacyStatus: "public" },
          }],
        });
      }
      return json({ items: [] });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["SaaS"],
      countries: ["US"],
      maxResults: 5,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["UCclub"]);
  });

  it("fills the requested count with name and description matches before a single video mention", async () => {
    expect(topicTier({ title: "Caleb Hammer", handle: null, description: "Weekly finance show", videoTitle: "Episode 12", recentTitles: [], keywords: ["Finance"] })).toBe("strong");
    expect(topicTier({ title: "AI Lab", handle: null, description: "", videoTitle: null, recentTitles: [], keywords: ["artificial intelligence"] })).toBe("strong");
    expect(topicTier({ title: "Daily Cuts", handle: null, description: "", videoTitle: "Intro", recentTitles: ["Finance Friday", "More finance talk"], keywords: ["Finance"] })).toBe("strong");
    expect(topicTier({ title: "CBS News", handle: "@cbs", description: "Breaking news", videoTitle: "What is artificial intelligence?", recentTitles: ["Evening news"], keywords: ["artificial intelligence"] })).toBe("video");
    expect(topicTier({ title: "CBS News", handle: null, description: "Evening intelligence briefing", videoTitle: null, recentTitles: [], keywords: ["artificial intelligence"] })).toBe("none");
    expect(topicTier({ title: "Home Cook", handle: null, description: "", videoTitle: null, recentTitles: [], keywords: ["Food"] })).toBe("strong");
    expect(topicTier({ title: "Finance Hebdo", handle: null, description: "", videoTitle: null, recentTitles: [], keywords: ["Business et finance"] })).toBe("strong");
    expect(topicTier({ title: "Tech Weekly", handle: null, description: "", videoTitle: null, recentTitles: [], keywords: ["AI and tech"] })).toBe("strong");
    expect(topicTier({ title: "Les affaires", handle: null, description: "", videoTitle: null, recentTitles: [], keywords: ["Business et finance"] })).toBe("none");
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/search") && parsed.searchParams.get("type") === "video") {
        return json({
          items: [
            { id: { videoId: "n", channelId: "UCnews" }, snippet: { title: "What is SaaS?", channelTitle: "ABC News", description: "tips@abc.test" } },
            { id: { videoId: "s", channelId: "UCclub" }, snippet: { title: "Pricing", channelTitle: "SaaS Club", description: "hello@saasclub.test" } },
          ],
        });
      }
      if (parsed.pathname.endsWith("/search")) return json({ items: [] });
      if (parsed.pathname.endsWith("/channels")) {
        return json({
          items: [
            { id: "UCnews", snippet: { title: "ABC News", description: "tips@abc.test", country: "US" }, statistics: { subscriberCount: "10", hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: "UUnews" } } },
            { id: "UCclub", snippet: { title: "SaaS Club", customUrl: "@saasclub", description: "hello@saasclub.test", country: "US" }, statistics: { subscriberCount: "10", hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: "UUclub" } } },
          ],
        });
      }
      if (parsed.pathname.endsWith("/playlistItems")) {
        return json({ items: [{ contentDetails: { videoId: "s", videoPublishedAt: recent } }] });
      }
      if (parsed.pathname.endsWith("/videos")) {
        return json({
          items: [{
            id: "s",
            snippet: { title: "Pricing", publishedAt: recent, liveBroadcastContent: "none" },
            statistics: { viewCount: "100" },
            status: { privacyStatus: "public" },
          }],
        });
      }
      return json({ items: [] });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["SaaS"],
      countries: ["US"],
      maxResults: 1,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["UCclub"]);
    const playlists = fetchImpl.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.pathname.endsWith("/playlistItems"));
    expect(playlists.map((url) => url.searchParams.get("playlistId"))).toEqual(["UUclub"]);
  });

  it("drops a stale channel and a channel whose views are far below its subscribers", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/search")) {
        return json({
          items: [
            { id: { channelId: "UCstale" }, snippet: { channelTitle: "SaaS Stale", description: "saas" } },
            { id: { channelId: "UCquiet" }, snippet: { channelTitle: "SaaS Quiet", description: "saas" } },
          ],
        });
      }
      if (parsed.pathname.endsWith("/channels")) {
        return json({
          items: [
            {
              id: "UCstale",
              snippet: { title: "SaaS Stale", description: "saas", country: "US" },
              statistics: { subscriberCount: "10000", hiddenSubscriberCount: false },
              contentDetails: { relatedPlaylists: { uploads: "UUstale" } },
            },
            {
              id: "UCquiet",
              snippet: { title: "SaaS Quiet", description: "saas", country: "US" },
              statistics: { subscriberCount: "100000", hiddenSubscriberCount: false },
              contentDetails: { relatedPlaylists: { uploads: "UUquiet" } },
            },
          ],
        });
      }
      if (parsed.pathname.endsWith("/playlistItems")) {
        const playlistId = parsed.searchParams.get("playlistId");
        const publishedAt = playlistId === "UUstale" ? "2020-01-01T00:00:00.000Z" : recent;
        const videoId = playlistId === "UUstale" ? "old" : "quiet";
        return json({ items: [{ contentDetails: { videoId, videoPublishedAt: publishedAt } }] });
      }
      return json({
        items: [
          { id: "old", snippet: { title: "Old", publishedAt: "2020-01-01T00:00:00.000Z", liveBroadcastContent: "none" }, statistics: { viewCount: "9000" }, status: { privacyStatus: "public" } },
          { id: "quiet", snippet: { title: "Quiet", publishedAt: recent, liveBroadcastContent: "none" }, statistics: { viewCount: "100" }, status: { privacyStatus: "public" } },
        ],
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["SaaS"],
      countries: ["US"],
      maxResults: 5,
    });
    expect(result.channels).toEqual([]);
    expect(result.filteredOut).toBeGreaterThan(0);
  });
});

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
