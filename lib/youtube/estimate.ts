import { YOUTUBE_QUOTA_COSTS } from "@/lib/constants";
import { searchQueries } from "@/lib/youtube/terms";

export function inspectLimit(maxResults: number) {
  const requested = Math.max(1, maxResults);
  return Math.min(200, Math.max(requested, requested * 5));
}

export function estimateSearchQuota(input: {
  keywordCount: number;
  countryCount: number;
  maxResults: number;
  includeRecentVideos: boolean;
  keywords?: string[];
  countries?: string[];
}) {
  const requested = Math.max(1, input.maxResults);
  const pages = Math.min(3, Math.max(1, Math.ceil(requested / 50)));
  const extraSearches = aliasSearches(input.keywords ?? [], input.countries ?? []);
  const searches = Math.max(1, input.keywordCount) * Math.max(1, input.countryCount) * pages * 2 + extraSearches;
  const channelLookups = pages;
  const uploadLookups = requested;
  const videoLookups = Math.max(1, Math.ceil((requested * 11) / 50));
  void input.includeRecentVideos;
  return (
    searches * YOUTUBE_QUOTA_COSTS.search +
    channelLookups * YOUTUBE_QUOTA_COSTS.channels +
    uploadLookups * YOUTUBE_QUOTA_COSTS.playlistItems +
    videoLookups * YOUTUBE_QUOTA_COSTS.videos
  );
}

function aliasSearches(keywords: string[], countries: string[]) {
  let extra = 0;
  for (const country of countries) {
    for (const keyword of keywords) extra += Math.max(0, searchQueries(keyword, country).length - 1);
  }
  return extra;
}
