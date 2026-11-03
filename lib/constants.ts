export const APP_NAME = "Creator Email Finder";
export const COMPANY_NAME = "Wayo Ads";
export const MIN_CREATOR_SUBSCRIBERS = 5000;
export const MAX_CREATOR_SUBSCRIBERS = 1_000_000;

export const TARGET_COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
] as const;

export const ADDITIONAL_COUNTRIES = [
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "JP", name: "Japan" },
] as const;

export const ALL_COUNTRIES = [...TARGET_COUNTRIES, ...ADDITIONAL_COUNTRIES];

export const EMAIL_STATUSES = [
  "DISCOVERED",
  "SYNTAX_VALID",
  "VERIFIED",
  "INVALID",
  "UNKNOWN",
  "NOT_FOUND",
  "NEEDS_REVIEW",
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const SUBSCRIBER_RANGES = [
  { id: "unknown", label: "Not public", min: null, max: null },
  { id: "0-1k", label: "Under 1K", min: 0, max: 999 },
  { id: "1k-10k", label: "1K–10K", min: 1000, max: 9999 },
  { id: "10k-50k", label: "10K–50K", min: 10000, max: 49999 },
  { id: "50k-100k", label: "50K–100K", min: 50000, max: 99999 },
  { id: "100k-1m", label: "100K–1M", min: 100000, max: 999999 },
  { id: "1m+", label: "1M+", min: 1000000, max: null },
] as const;

export const YOUTUBE_QUOTA_COSTS = {
  search: 100,
  channels: 1,
  playlistItems: 1,
  videos: 1,
} as const;

export const CSV_FIELDS = [
  "channel_id",
  "channel_name",
  "channel_url",
  "video_url",
  "country",
  "subscriber_count",
  "website_url",
  "email",
  "ignore",
] as const;

export type CsvField = (typeof CSV_FIELDS)[number];

export const EXPORT_COLUMNS = [
  "channelName",
  "handle",
  "youtubeUrl",
  "subscribers",
  "averageViews",
  "email",
  "website",
  "instagram",
  "twitter",
  "tiktok",
  "lastActiveAt",
  "matchedVideoTitle",
  "matchedVideoUrl",
  "matchedVideoViews",
  "matchedVideoPublishedAt",
] as const;
