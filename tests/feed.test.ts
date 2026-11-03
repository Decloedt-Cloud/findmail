import { describe, expect, it } from "vitest";
import { activityFromFeed, latestFeedPublishedAt, uploadsFeedUrl } from "@/lib/youtube/feed";

const now = new Date("2026-10-28T12:00:00.000Z");

const feed = (published: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <updated>2026-10-28T12:00:00+00:00</updated>
  <entry>
    <published>${published}</published>
    <yt:videoId>abc</yt:videoId>
  </entry>
  <entry>
    <published>2024-01-01T00:00:00+00:00</published>
  </entry>
</feed>`;

describe("YouTube uploads feed", () => {
  it("builds the public feed url from the channel id", () => {
    expect(uploadsFeedUrl("UC1234567890123456789012")).toBe(
      "https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012",
    );
  });

  it("reads the newest entry date and ignores the feed update", () => {
    expect(latestFeedPublishedAt(feed("2026-10-01T00:00:00+00:00"))).toBe("2026-10-01T00:00:00+00:00");
    expect(latestFeedPublishedAt("<feed><updated>2026-10-28T00:00:00Z</updated></feed>")).toBeNull();
  });

  it("keeps a recent upload and drops an old one, a missing channel, or an empty feed", () => {
    expect(activityFromFeed(200, feed("2026-10-01T00:00:00+00:00"), now)).toEqual({
      kind: "active",
      publishedAt: "2026-10-01T00:00:00+00:00",
    });
    expect(activityFromFeed(200, feed("2026-01-01T00:00:00+00:00"), now).kind).toBe("inactive");
    expect(activityFromFeed(200, "<feed></feed>", now).kind).toBe("inactive");
    expect(activityFromFeed(404, "", now).kind).toBe("missing");
    expect(activityFromFeed(429, "", now).kind).toBe("rate-limited");
    expect(activityFromFeed(500, feed("2026-10-01T00:00:00+00:00"), now).kind).toBe("unavailable");
  });
});
