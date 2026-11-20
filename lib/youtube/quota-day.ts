/**
 * Google resets YouTube Data API quotas at midnight in the Pacific time zone.
 * The app's daily counter starts at the same moment so it matches what Google accepts.
 */
const QUOTA_TIME_ZONE = "America/Los_Angeles";

/**
 * Start of the YouTube quota window for `now`.
 * Counting starts at midnight Pacific, or at YOUTUBE_QUOTA_SINCE when a newer API key was put in place.
 * Rows created before that moment were charged to another project, so they must not count here.
 */
export function youtubeQuotaDayStart(now = new Date(), since = process.env.YOUTUBE_QUOTA_SINCE): Date {
  const dayStart = pacificDayStart(now);
  const cutoff = parseIsoDate(since);
  if (cutoff && cutoff > dayStart && cutoff <= now) return cutoff;
  return dayStart;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function pacificDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const midnightWallAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"));
  return new Date(midnightWallAsUtc - offsetMs);
}

/**
 * Set ICP_MATCHING_PAUSED_UNTIL (ISO date) to stop new ICP searches until then.
 * Used while the shared YouTube search limit is spent.
 */
export function icpSearchPausedUntil(value = process.env.ICP_MATCHING_PAUSED_UNTIL): Date | null {
  return parseIsoDate(value);
}
