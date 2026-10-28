import { describe, expect, it, vi } from "vitest";
import {
  YouTubeApiError,
  YouTubeClient,
  createYouTubeClient,
  dedupeIds,
  estimateSearchQuota,
  parseBrandingKeywords,
  matchesDeclaredCountry,
  matchesSearchCountry,
  matchesSubscriberRange,
  paginateSearch,
  parseYouTubeReference,
} from "@/lib/youtube/client";
import { audienceFocus, audienceSearchPasses } from "@/lib/youtube/audience";
import { discoverYouTubeChannels, topicTier } from "@/lib/youtube/discovery";
import { matchTerms, reuseLimit, searchQueries } from "@/lib/youtube/terms";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const RECENT_PUBLISHED = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

function recentActivity(pathname: string) {
  if (pathname.endsWith("/playlistItems")) {
    return jsonResponse({
      items: [{ contentDetails: { videoId: "recent", videoPublishedAt: RECENT_PUBLISHED } }],
    });
  }
  return jsonResponse({
    items: [{
      id: "recent",
      snippet: { title: "Recent", publishedAt: RECENT_PUBLISHED, liveBroadcastContent: "none" },
      statistics: { viewCount: "500000" },
      status: { privacyStatus: "public" },
    }],
  });
}

describe("youtube pagination and dedupe", () => {
  it("follows page tokens and collapses repeated channel ids", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        if (!parsed.searchParams.get("pageToken")) {
          return jsonResponse({
            nextPageToken: "next",
            items: [{ id: { channelId: "UC1" }, snippet: { channelTitle: "AI One", description: "" } }],
          });
        }
        return jsonResponse({
          items: [
            { id: { channelId: "UC1" }, snippet: { channelTitle: "AI One", description: "" } },
            { id: { channelId: "UC2" }, snippet: { channelTitle: "Two", description: "" } },
          ],
        });
      }
      return jsonResponse({
        items: [
          { id: "UC1", snippet: { title: "AI One", country: "US" }, statistics: { subscriberCount: "1000", hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: "UUUC1" } } },
          { id: "UC2", snippet: { title: "Two", country: "FR" }, statistics: { hiddenSubscriberCount: true } },
        ],
      });
    });
    const client = new YouTubeClient("test-key", fetchImpl);
    const page = await paginateSearch(client, { query: "ai", type: "channel", maxResults: 50 });
    expect(dedupeIds(page.map((item) => item.channelId))).toEqual({ unique: ["UC1", "UC2"], duplicates: 1 });
    const result = await discoverYouTubeChannels(client, { keywords: ["ai"], countries: ["US"], maxResults: 10 });
    expect(result.channels.map((channel) => channel.id)).toEqual(["UC1"]);
    expect(result.channels[0]?.subscriberVisibility).toBe("PUBLIC");
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });

  it("pages past channels that do not declare the requested country", async () => {
    const foreign = ["US1", "US2", "US3", "US4", "US5"];
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        if (!parsed.searchParams.get("pageToken")) {
          return jsonResponse({
            nextPageToken: "p2",
            items: foreign.map((id) => ({ id: { channelId: id }, snippet: { channelTitle: id, description: "" } })),
          });
        }
        return jsonResponse({
          items: [{ id: { channelId: "FR1" }, snippet: { channelTitle: "Entreprise locale", description: "business" } }],
        });
      }
      const ids = (parsed.searchParams.get("id") ?? "").split(",").filter(Boolean);
      return jsonResponse({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: id === "FR1" ? "Entreprise locale" : id,
            description: id === "FR1" ? "Conseil en business" : "",
            country: id === "FR1" ? "FR" : "US",
          },
          statistics: { subscriberCount: "1000", hiddenSubscriberCount: false },
          contentDetails: { relatedPlaylists: { uploads: `UU${id}` } },
        })),
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Business"],
      countries: ["FR"],
      maxResults: 1,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["FR1"]);
  });

  it("keeps paging when declared channels are off the topic", async () => {
    const offTopic = ["A", "B", "C", "D", "E"];
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        const query = parsed.searchParams.get("q");
        if (query !== "Business") return jsonResponse({ items: [] });
        if (!parsed.searchParams.get("pageToken")) {
          return jsonResponse({
            nextPageToken: "p2",
            items: offTopic.map((id) => ({ id: { channelId: id }, snippet: { channelTitle: `Chaine ${id}`, description: "" } })),
          });
        }
        return jsonResponse({
          items: [{ id: { channelId: "FRBIZ" }, snippet: { channelTitle: "Entreprise locale", description: "business" } }],
        });
      }
      const ids = (parsed.searchParams.get("id") ?? "").split(",").filter(Boolean);
      return jsonResponse({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: id === "FRBIZ" ? "Entreprise locale" : `Chaine ${id}`,
            description: id === "FRBIZ" ? "Conseil en business" : "Voyage et cuisine",
            country: "FR",
          },
          statistics: { subscriberCount: "1000", hiddenSubscriberCount: false },
          contentDetails: { relatedPlaylists: { uploads: `UU${id}` } },
        })),
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Business"],
      countries: ["FR"],
      maxResults: 1,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["FRBIZ"]);
  });

  it("stops at the requested creator count even when no email is written", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        return jsonResponse({
          items: [
            { id: { channelId: "ONE" }, snippet: { channelTitle: "Business One", description: "" } },
            { id: { channelId: "TWO" }, snippet: { channelTitle: "Business Two", description: "" } },
          ],
        });
      }
      if (parsed.pathname.endsWith("/channels")) {
        return jsonResponse({
          items: ["ONE", "TWO"].map((id) => ({
            id,
            snippet: { title: id === "ONE" ? "Business One" : "Business Two", description: "Pas de contact", country: "FR" },
            statistics: { subscriberCount: "1000", hiddenSubscriberCount: false },
            contentDetails: { relatedPlaylists: { uploads: `UU${id}` } },
          })),
        });
      }
      return jsonResponse({ items: [] });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Business"],
      countries: ["FR"],
      maxResults: 1,
    });
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.descriptionEmails).toEqual([]);
    const playlists = fetchImpl.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.pathname.endsWith("/playlistItems"));
    expect(playlists).toHaveLength(1);
  });

  it("searches recent videos first when the audience is small", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        if (parsed.searchParams.get("order") !== "date") {
          return jsonResponse({
            items: [{ id: { videoId: "big", channelId: "UCbig" }, snippet: { title: "Food empire", channelTitle: "Giant", description: "" } }],
          });
        }
        return jsonResponse({
          items: [{ id: { videoId: "small", channelId: "UCsmall" }, snippet: { title: "Food diary", channelTitle: "Home Cook", description: "Weekly food videos" } }],
        });
      }
      const id = parsed.searchParams.get("id");
      if (id === "UCbig") {
        return jsonResponse({
          items: [{ id: "UCbig", snippet: { title: "Giant", country: "US" }, statistics: { subscriberCount: "5000000", hiddenSubscriberCount: false } }],
        });
      }
      return jsonResponse({
        items: [{
          id: "UCsmall",
          snippet: { title: "Home Cook", description: "Weekly food videos", country: "US" },
          statistics: { subscriberCount: "12000", hiddenSubscriberCount: false },
          contentDetails: { relatedPlaylists: { uploads: "UUsmall" } },
        }],
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Food"],
      countries: ["US"],
      maxResults: 1,
      minSubscribers: 5000,
      maxSubscribers: 20000,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["UCsmall"]);
    const orders = fetchImpl.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.pathname.endsWith("/search"))
      .map((url) => url.searchParams.get("order"));
    expect(orders[0]).toBe("date");
  });

  it("searches the most viewed videos first when the audience is large", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        if (parsed.searchParams.get("order") !== "viewCount") {
          return jsonResponse({
            items: [{ id: { channelId: "UCsmall" }, snippet: { channelTitle: "Tiny Finance", description: "finance" } }],
          });
        }
        return jsonResponse({
          items: [{ id: { videoId: "big", channelId: "UCbig" }, snippet: { title: "Finance daily", channelTitle: "Finance Daily", description: "" } }],
        });
      }
      const id = parsed.searchParams.get("id");
      if (id === "UCsmall") {
        return jsonResponse({
          items: [{ id: "UCsmall", snippet: { title: "Tiny Finance", description: "finance", country: "US" }, statistics: { subscriberCount: "8000", hiddenSubscriberCount: false } }],
        });
      }
      return jsonResponse({
        items: [{
          id: "UCbig",
          snippet: { title: "Finance Daily", description: "Daily finance", country: "US" },
          statistics: { subscriberCount: "2000000", hiddenSubscriberCount: false },
          contentDetails: { relatedPlaylists: { uploads: "UUbig" } },
        }],
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Finance"],
      countries: ["US"],
      maxResults: 1,
      minSubscribers: 500000,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["UCbig"]);
    const firstSearch = fetchImpl.mock.calls.map((call) => new URL(String(call[0]))).find((url) => url.pathname.endsWith("/search"));
    expect(firstSearch?.searchParams.get("order")).toBe("viewCount");
    expect(firstSearch?.searchParams.get("type")).toBe("video");
  });

  it("searches the French alias when the English query finds nobody", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/playlistItems") || parsed.pathname.endsWith("/videos")) return recentActivity(parsed.pathname);
      if (parsed.pathname.endsWith("/search")) {
        if (parsed.searchParams.get("q") !== "entrepreneuriat") return jsonResponse({ items: [] });
        return jsonResponse({
          items: [{ id: { channelId: "FRENT" }, snippet: { channelTitle: "Atelier", description: "" } }],
        });
      }
      return jsonResponse({
        items: [{
          id: "FRENT",
          snippet: { title: "Atelier", description: "Formation entrepreneuriat", country: "FR" },
          statistics: { subscriberCount: "800", hiddenSubscriberCount: false },
          contentDetails: { relatedPlaylists: { uploads: "UUFRENT" } },
        }],
      });
    });
    const result = await discoverYouTubeChannels(new YouTubeClient("test-key", fetchImpl), {
      keywords: ["Business"],
      countries: ["FR"],
      maxResults: 1,
    });
    expect(result.channels.map((channel) => channel.id)).toEqual(["FRENT"]);
  });

  it("does not infer country from language and keeps hidden counts empty", () => {
    expect(matchesDeclaredCountry(null, ["FR"])).toBe(false);
    expect(matchesDeclaredCountry(null, [])).toBe(true);
    expect(matchesDeclaredCountry("DE", ["US"])).toBe(false);
    expect(matchesSearchCountry({ country: null, discoveryRegion: "FR" }, ["FR"])).toBe(false);
    expect(matchesSearchCountry({ country: "FR", discoveryRegion: "US" }, ["FR"])).toBe(true);
    expect(matchesSearchCountry({ country: "US", discoveryRegion: "FR" }, ["FR"])).toBe(false);
    expect(matchesSubscriberRange("HIDDEN", null, 1000, null)).toBe(false);
    expect(matchesSubscriberRange("PUBLIC", 1500, 1000, 2000)).toBe(true);
  });

  it("parses channel, handle, and video URLs", () => {
    expect(parseYouTubeReference("https://www.youtube.com/channel/UC1234567890123456789012").channelId).toBe("UC1234567890123456789012");
    expect(parseYouTubeReference("https://www.youtube.com/@ada").handle).toBe("@ada");
    expect(parseYouTubeReference("https://youtu.be/abcdefghijk").videoId).toBe("abcdefghijk");
  });
});

describe("youtube credentials and quota", () => {
  it("does not call the network when the API key is missing", async () => {
    const fetchImpl = vi.fn();
    delete process.env.YOUTUBE_API_KEY;
    expect(() => createYouTubeClient(fetchImpl)).toThrow(YouTubeApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops on quota exhaustion without marking the response successful", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
    );
    const client = new YouTubeClient("test-key", fetchImpl);
    await expect(client.search({ query: "ai", type: "channel", maxResults: 5 })).rejects.toMatchObject({ code: "QUOTA" });
  });

  it("estimates search cost from the pages needed to fill qualified results", () => {
    expect(estimateSearchQuota({ keywordCount: 1, countryCount: 1, maxResults: 10, includeRecentVideos: false })).toBe(214);
    expect(estimateSearchQuota({ keywordCount: 1, countryCount: 1, maxResults: 50, includeRecentVideos: false })).toBe(262);
    expect(estimateSearchQuota({
      keywordCount: 1,
      countryCount: 1,
      maxResults: 10,
      includeRecentVideos: false,
      keywords: ["Business"],
      countries: ["FR"],
    })).toBe(514);
  });

  it("splits filler words and caps stored creators at half the request", () => {
    expect(matchTerms("Business et finance")).toEqual(["Business", "finance"]);
    expect(matchTerms("artificial intelligence")).toEqual(["artificial intelligence"]);
    expect(searchQueries("Business", "FR")).toEqual(["Business", "entrepreneur", "entreprise", "entrepreneuriat"]);
    expect(searchQueries("Business", "US")).toEqual(["Business"]);
    expect(audienceFocus(5000, 20000)).toBe("small");
    expect(audienceFocus(20000, 100000)).toBe("mid");
    expect(audienceFocus(500000, null)).toBe("large");
    expect(audienceFocus(5000, null)).toBe("broad");
    expect(audienceSearchPasses(5000, 20000)).toEqual([{ type: "video", order: "date" }, { type: "video" }]);
    expect(audienceSearchPasses(500000, null)[0]).toEqual({ type: "video", order: "viewCount" });
    expect(audienceSearchPasses(5000, null)).toEqual([{ type: "channel" }, { type: "video" }]);
    expect(topicTier({ title: "Finance Hebdo", handle: null, description: "", videoTitle: null, keywords: ["Business et finance"] })).toBe("strong");
    expect(reuseLimit(10)).toBe(5);
    expect(reuseLimit(25)).toBe(12);
    expect(reuseLimit(1)).toBe(0);
  });

  it("keeps quoted YouTube keywords together", () => {
    expect(parseBrandingKeywords('SaaS "B2B SaaS" startup')).toEqual(["SaaS", "B2B SaaS", "startup"]);
  });
});
