import { YOUTUBE_QUOTA_COSTS } from "@/lib/constants";
import { audienceSearchPasses } from "@/lib/youtube/audience";
import { searchQueries } from "@/lib/youtube/terms";

/** Same page cap as `discoverYouTubeChannels`. */
const MAX_PAGES_PER_QUERY = 3;

/** Uploads pulled per channel in `enrichActivity`, plus the matched search video. */
const VIDEOS_PER_CHANNEL = 21;

export function inspectLimit(maxResults: number) {
  const requested = Math.max(1, maxResults);
  return Math.min(200, Math.max(requested, requested * 5));
}

/**
 * Upper-bound YouTube quota for a Discover search.
 * Mirrors the nested search loops and activity enrichment; early exits usually
 * spend less, so the UI should present this as "up to".
 */
export function estimateSearchQuota(input: {
  keywordCount: number;
  countryCount: number;
  maxResults: number;
  includeRecentVideos: boolean;
  keywords?: string[];
  countries?: string[];
  minSubscribers?: number | null;
  maxSubscribers?: number | null;
}) {
  void input.includeRecentVideos;
  const requested = Math.max(1, input.maxResults);
  const cap = inspectLimit(requested);
  const passes = Math.max(1, audienceSearchPasses(input.minSubscribers, input.maxSubscribers).length);
  const countries =
    input.countries && input.countries.length > 0
      ? input.countries
      : Array.from({ length: Math.max(1, input.countryCount) }, () => "XX");
  const keywords =
    input.keywords && input.keywords.length > 0
      ? input.keywords
      : Array.from({ length: Math.max(1, input.keywordCount) }, () => "topic");

  let searchCalls = 0;
  for (const country of countries) {
    for (const keyword of keywords) {
      const terms = Math.max(1, searchQueries(keyword, country).length);
      searchCalls += terms * passes * MAX_PAGES_PER_QUERY;
    }
  }

  const channelLookups = searchCalls;
  const uploadLookups = cap;
  const videoLookups = Math.max(1, Math.ceil((cap * VIDEOS_PER_CHANNEL) / 50));

  return (
    searchCalls * YOUTUBE_QUOTA_COSTS.search +
    channelLookups * YOUTUBE_QUOTA_COSTS.channels +
    uploadLookups * YOUTUBE_QUOTA_COSTS.playlistItems +
    videoLookups * YOUTUBE_QUOTA_COSTS.videos
  );
}
