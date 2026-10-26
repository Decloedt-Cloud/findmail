export type YouTubeSearchItem = {
  kind: "channel" | "video";
  channelId: string;
  videoId?: string;
  title: string;
  videoTitle?: string;
  description: string;
  publishedAt?: string;
};

export type YouTubeSearchPage = {
  items: YouTubeSearchItem[];
  nextPageToken?: string;
};

export type SubscriberVisibility = "PUBLIC" | "HIDDEN" | "UNAVAILABLE";

export type YouTubeChannel = {
  id: string;
  title: string;
  description: string;
  customUrl: string | null;
  country: string | null;
  defaultLanguage: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  subscriberVisibility: SubscriberVisibility;
  videoCount: number | null;
  viewCount: string | null;
  keywords: string[];
  uploadsPlaylistId: string | null;
};

export type YouTubeFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly code: "QUOTA" | "RETRYABLE" | "FATAL" | "NOT_CONFIGURED",
    readonly status = 0,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

type QuotaHandler = (units: number, operation: string, success: boolean, message?: string) => Promise<void> | void;

const COSTS = { search: 100, channels: 1, videos: 1, playlistItems: 1 } as const;

export function dedupeIds(ids: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicates = 0;
  for (const id of ids) {
    const key = id.trim();
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else {
      seen.add(key);
      unique.push(key);
    }
  }
  return { unique, duplicates };
}

export function matchesSubscriberRange(
  visibility: SubscriberVisibility,
  count: number | null,
  min?: number | null,
  max?: number | null,
) {
  if (min == null && max == null) return true;
  if (visibility !== "PUBLIC" || count == null) return false;
  if (min != null && count < min) return false;
  if (max != null && count > max) return false;
  return true;
}

export function matchesDeclaredCountry(channelCountry: string | null, requested: string[]) {
  if (requested.length === 0) return true;
  if (!channelCountry) return false;
  return requested.map((country) => country.toUpperCase()).includes(channelCountry.toUpperCase());
}

export function matchesSearchCountry(
  creator: { country: string | null; discoveryRegion?: string | null },
  requested: string[],
) {
  return matchesDeclaredCountry(creator.country, requested);
}

export function parseYouTubeReference(value: string) {
  const trimmed = value.trim();
  if (/^UC[\w-]{20,}$/.test(trimmed)) return { channelId: trimmed };
  if (trimmed.startsWith("@")) return { handle: trimmed };
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const videoId = url.pathname.split("/").filter(Boolean)[0];
      return videoId ? { videoId } : {};
    }
    if (host !== "youtube.com" && host !== "m.youtube.com") return {};
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "channel" && parts[1]) return { channelId: parts[1] };
    if (parts[0]?.startsWith("@")) return { handle: parts[0] };
    if (parts[0] === "watch") {
      const videoId = url.searchParams.get("v");
      return videoId ? { videoId } : {};
    }
    if ((parts[0] === "shorts" || parts[0] === "live") && parts[1]) return { videoId: parts[1] };
    return {};
  } catch {
    return {};
  }
}

export { estimateSearchQuota, inspectLimit } from "@/lib/youtube/estimate";

export function parseBrandingKeywords(value: string) {
  const keywords: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const token = (match[1] ?? match[2] ?? "").trim();
    if (!token) continue;
    keywords.push(token);
    if (keywords.length >= 20) break;
  }
  return keywords;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function googleReason(body: unknown) {
  const error = asRecord(asRecord(body).error);
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const first = asRecord(errors[0]);
  return String(first.reason ?? error.status ?? "");
}

export class YouTubeClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: YouTubeFetch,
    private readonly onQuota?: QuotaHandler,
    private readonly beforeRequest?: (units: number) => Promise<void> | void,
  ) {
    if (!apiKey) {
      throw new YouTubeApiError("YOUTUBE_API_KEY is not configured", "NOT_CONFIGURED");
    }
  }

  private async get(path: string, params: Record<string, string | undefined>, operation: keyof typeof COSTS) {
    await this.beforeRequest?.(COSTS[operation]);
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.searchParams.set("key", this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    let response: Awaited<ReturnType<YouTubeFetch>>;
    try {
      response = await this.fetchImpl(url.toString());
    } catch (error) {
      await this.onQuota?.(COSTS[operation], operation, false, "network");
      throw new YouTubeApiError(error instanceof Error ? error.message : "YouTube request failed", "RETRYABLE");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = googleReason(body);
      const quota = /quota|dailyLimit/i.test(reason);
      const retryable = quota ? false : response.status === 429 || response.status >= 500 || /rateLimit/i.test(reason);
      await this.onQuota?.(COSTS[operation], operation, false, reason || String(response.status));
      throw new YouTubeApiError(
        quota
          ? "YouTube Data API quota is exhausted. Try again after the quota resets."
          : `YouTube Data API request failed (${reason || response.status})`,
        quota ? "QUOTA" : retryable ? "RETRYABLE" : "FATAL",
        response.status,
      );
    }
    await this.onQuota?.(COSTS[operation], operation, true);
    return body;
  }

  async search(input: {
    query: string;
    type: "channel" | "video";
    regionCode?: string;
    relevanceLanguage?: string;
    publishedAfter?: string;
    channelId?: string;
    pageToken?: string;
    maxResults: number;
    order?: "date" | "rating" | "relevance" | "title" | "videoCount" | "viewCount";
  }): Promise<YouTubeSearchPage> {
    const body = asRecord(
      await this.get(
        "search",
        {
          part: "snippet",
          q: input.query,
          type: input.type,
          channelId: input.channelId,
          regionCode: input.regionCode,
          relevanceLanguage: input.relevanceLanguage,
          publishedAfter: input.publishedAfter,
          pageToken: input.pageToken,
          order: input.order && input.order !== "relevance" ? input.order : undefined,
          maxResults: String(Math.min(50, Math.max(1, input.maxResults))),
        },
        "search",
      ),
    );
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: YouTubeSearchItem[] = [];
    for (const item of rawItems) {
      const record = asRecord(item);
      const id = asRecord(record.id);
      const snippet = asRecord(record.snippet);
      const channelId = String(id.channelId ?? snippet.channelId ?? "");
      if (!channelId) continue;
      items.push({
        kind: input.type,
        channelId,
        videoId: typeof id.videoId === "string" ? id.videoId : undefined,
        title: String(snippet.channelTitle ?? snippet.title ?? ""),
        videoTitle: input.type === "video" ? String(snippet.title ?? "") : undefined,
        description: String(snippet.description ?? ""),
        publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : undefined,
      });
    }
    return {
      nextPageToken: typeof body.nextPageToken === "string" ? body.nextPageToken : undefined,
      items,
    };
  }

  async listChannels(ids: string[]): Promise<YouTubeChannel[]> {
    if (ids.length === 0) return [];
    const body = asRecord(
      await this.get(
        "channels",
        {
          part: "snippet,statistics,brandingSettings,contentDetails,status",
          id: ids.slice(0, 50).join(","),
          maxResults: "50",
        },
        "channels",
      ),
    );
    return (Array.isArray(body.items) ? body.items : []).map((item) => mapChannel(item));
  }

  async channelForHandle(handle: string): Promise<YouTubeChannel | null> {
    const body = asRecord(
      await this.get(
        "channels",
        { part: "snippet,statistics,brandingSettings,contentDetails,status", forHandle: handle.replace(/^@/, "") },
        "channels",
      ),
    );
    const first = Array.isArray(body.items) ? body.items[0] : null;
    return first ? mapChannel(first) : null;
  }

  async listUploads(playlistId: string, maxResults = 20) {
    const body = asRecord(
      await this.get(
        "playlistItems",
        {
          part: "snippet,contentDetails",
          playlistId,
          maxResults: String(Math.min(50, Math.max(1, maxResults))),
        },
        "playlistItems",
      ),
    );
    const items: { videoId: string; publishedAt: string | null }[] = [];
    for (const item of Array.isArray(body.items) ? body.items : []) {
      const record = asRecord(item);
      const content = asRecord(record.contentDetails);
      const snippet = asRecord(record.snippet);
      const resource = asRecord(snippet.resourceId);
      const videoId = String(content.videoId ?? resource.videoId ?? "");
      if (!videoId) continue;
      const published = content.videoPublishedAt ?? snippet.publishedAt;
      items.push({ videoId, publishedAt: typeof published === "string" ? published : null });
    }
    return items;
  }

  async listVideos(ids: string[]) {
    if (ids.length === 0) return [];
    const body = asRecord(
      await this.get(
        "videos",
        {
          part: "snippet,statistics,status",
          id: ids.slice(0, 50).join(","),
          maxResults: "50",
        },
        "videos",
      ),
    );
    return (Array.isArray(body.items) ? body.items : []).map((item) => mapVideo(item));
  }

  async channelIdForVideo(videoId: string): Promise<string | null> {
    const body = asRecord(await this.get("videos", { part: "snippet", id: videoId }, "videos"));
    const first = Array.isArray(body.items) ? asRecord(body.items[0]) : null;
    const snippet = asRecord(first?.snippet);
    return typeof snippet.channelId === "string" ? snippet.channelId : null;
  }
}

function mapChannel(item: unknown): YouTubeChannel {
  const record = asRecord(item);
  const snippet = asRecord(record.snippet);
  const statistics = asRecord(record.statistics);
  const branding = asRecord(asRecord(record.brandingSettings).channel);
  const thumbnails = asRecord(snippet.thumbnails);
  const thumb = asRecord(thumbnails.high ?? thumbnails.medium ?? thumbnails.default);
  const hidden = statistics.hiddenSubscriberCount === true;
  const hasSubscriberCount = typeof statistics.subscriberCount === "string" || typeof statistics.subscriberCount === "number";
  const description = String(branding.description || snippet.description || "");
  return {
    id: String(record.id ?? ""),
    title: String(snippet.title ?? ""),
    description,
    customUrl: typeof snippet.customUrl === "string" ? snippet.customUrl : null,
    country: typeof snippet.country === "string" ? snippet.country.toUpperCase() : null,
    defaultLanguage: typeof snippet.defaultLanguage === "string" ? snippet.defaultLanguage : null,
    thumbnailUrl: typeof thumb.url === "string" ? thumb.url : null,
    subscriberCount: hidden || !hasSubscriberCount ? null : Number(statistics.subscriberCount),
    subscriberVisibility: hidden ? "HIDDEN" : hasSubscriberCount ? "PUBLIC" : "UNAVAILABLE",
    videoCount: statistics.videoCount == null ? null : Number(statistics.videoCount),
    viewCount: statistics.viewCount == null ? null : String(statistics.viewCount),
    keywords: typeof branding.keywords === "string" ? parseBrandingKeywords(branding.keywords) : [],
    uploadsPlaylistId: typeof asRecord(asRecord(record.contentDetails).relatedPlaylists).uploads === "string"
      ? String(asRecord(asRecord(record.contentDetails).relatedPlaylists).uploads)
      : null,
  };
}

export type YouTubeVideoDetails = {
  id: string;
  title: string;
  description: string;
  publishedAt: string | null;
  viewCount: number | null;
  privacyStatus: string | null;
  liveBroadcastContent: string | null;
};

function mapVideo(item: unknown): YouTubeVideoDetails {
  const record = asRecord(item);
  const snippet = asRecord(record.snippet);
  const statistics = asRecord(record.statistics);
  const status = asRecord(record.status);
  const views = statistics.viewCount;
  const viewCount = typeof views === "string" || typeof views === "number" ? Number(views) : null;
  return {
    id: String(record.id ?? ""),
    title: String(snippet.title ?? ""),
    description: String(snippet.description ?? ""),
    publishedAt: typeof snippet.publishedAt === "string" ? snippet.publishedAt : null,
    viewCount: viewCount != null && Number.isFinite(viewCount) ? viewCount : null,
    privacyStatus: typeof status.privacyStatus === "string" ? status.privacyStatus : null,
    liveBroadcastContent: typeof snippet.liveBroadcastContent === "string" ? snippet.liveBroadcastContent : null,
  };
}

export async function paginateSearch(
  client: YouTubeClient,
  input: {
    query: string;
    type: "channel" | "video";
    regionCode?: string;
    relevanceLanguage?: string;
    publishedAfter?: string;
    maxResults: number;
  },
) {
  const items: YouTubeSearchItem[] = [];
  let pageToken: string | undefined;
  do {
    const page = await client.search({
      ...input,
      pageToken,
      maxResults: Math.min(50, input.maxResults - items.length),
    });
    items.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken && items.length < input.maxResults);
  return items.slice(0, input.maxResults);
}

export function createYouTubeClient(
  fetchImpl: YouTubeFetch,
  onQuota?: QuotaHandler,
  beforeRequest?: (units: number) => Promise<void> | void,
) {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new YouTubeApiError("YOUTUBE_API_KEY is not configured", "NOT_CONFIGURED");
  }
  return new YouTubeClient(apiKey, fetchImpl, onQuota, beforeRequest);
}
