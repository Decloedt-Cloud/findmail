import { scheduleDomain } from "@/lib/email/domain-limit";
import { crawlerUserAgent } from "@/lib/email/crawl";
import { safeFetch } from "@/lib/ssrf";
import { isRecentlyActive } from "@/lib/youtube/qualify";

const FEED_TYPES = ["application/atom+xml", "application/xml", "text/xml", "text/plain"];
const FEED_INTERVAL_MS = 2000;

function feedInterval() {
  const configured = Number(process.env.DOMAIN_REQUEST_INTERVAL_MS);
  if (Number.isFinite(configured) && configured > FEED_INTERVAL_MS) return configured;
  return FEED_INTERVAL_MS;
}

export type FeedActivity =
  | { kind: "active"; publishedAt: string }
  | { kind: "inactive" }
  | { kind: "missing" }
  | { kind: "unavailable" }
  | { kind: "rate-limited" };

export function uploadsFeedUrl(channelId: string) {
  const url = new URL("https://www.youtube.com/feeds/videos.xml");
  url.searchParams.set("channel_id", channelId);
  return url.toString();
}

/** Newest `<published>` inside an `<entry>`. The feed-level date is ignored. */
export function latestFeedPublishedAt(xml: string) {
  const dates: string[] = [];
  const entries = xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi);
  for (const entry of entries) {
    const published = entry[1]?.match(/<published>([^<]+)<\/published>/i)?.[1]?.trim();
    if (published) dates.push(published);
  }
  dates.sort();
  return dates.at(-1) ?? null;
}

export function activityFromFeed(status: number, body: string, now = new Date()): FeedActivity {
  if (status === 429) return { kind: "rate-limited" };
  if (status === 404 || status === 410) return { kind: "missing" };
  if (status !== 200) return { kind: "unavailable" };
  const publishedAt = latestFeedPublishedAt(body);
  if (!publishedAt || !isRecentlyActive(publishedAt, now)) return { kind: "inactive" };
  return { kind: "active", publishedAt };
}

export async function readUploadsFeed(channelId: string): Promise<FeedActivity> {
  if (!/^UC[\w-]{20,}$/.test(channelId)) return { kind: "unavailable" };
  return scheduleDomain("www.youtube.com", feedInterval(), async () => {
    try {
      const response = await safeFetch(uploadsFeedUrl(channelId), {
        timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10_000),
        maxBytes: 1_000_000,
        userAgent: crawlerUserAgent(),
        accept: FEED_TYPES,
      });
      return activityFromFeed(response.status, response.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/429|too many requests/i.test(message)) return { kind: "rate-limited" };
      return { kind: "unavailable" };
    }
  });
}
