import { matchesDeclaredCountry, matchesSubscriberRange, type YouTubeChannel } from "@/lib/youtube/client";

export const ICP_MIN_SUBSCRIBERS = 5_000;
export const ICP_MAX_SUBSCRIBERS = 1_000_000;

const EUROPE = [
  "FR", "DE", "GB", "ES", "IT", "NL", "BE", "PL", "PT", "SE", "CH", "AT", "IE", "DK", "NO", "FI", "CZ", "RO",
  "GR", "HU", "UA", "RU", "AD", "AL", "AX", "BA", "BG", "BY", "CY", "EE", "FO", "GG", "GI", "HR", "IM", "IS",
  "JE", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "RS", "SI", "SK", "SM", "VA", "XK",
];

const NORTH_AMERICA = ["US", "CA", "MX", "GL", "BM", "PM"];

const NORTH_AFRICA = ["MA", "DZ", "TN", "EG", "LY", "EH"];

const GULF = ["AE", "SA", "QA", "KW", "BH", "OM"];

export const ICP_COUNTRIES = [...EUROPE, ...NORTH_AMERICA, ...NORTH_AFRICA, ...GULF];

export const ICP_AUDIENCE_KEY = "5k-1m:global-search-reuse:v3";

/** Build a valid YouTube query; the search plan deliberately passes only its broadest phrase. */
export function icpSearchQuery(queries: string[]) {
  const parts: string[] = [];
  for (const query of queries) {
    const clean = query.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const next = parts.length === 0 ? clean : `${parts.join(" | ")} | ${clean}`;
    if (next.length > 160) break;
    parts.push(clean);
  }
  return parts.join(" | ");
}

export function icpSearchPlan(queries: string[]) {
  const query = icpSearchQuery(queries.slice(0, 1));
  if (!query) return [];
  return [{ query }];
}

export function matchesIcpAudience(channel: Pick<YouTubeChannel, "country" | "subscriberCount" | "subscriberVisibility">) {
  return (
    matchesDeclaredCountry(channel.country, ICP_COUNTRIES) &&
    matchesSubscriberRange(channel.subscriberVisibility, channel.subscriberCount, ICP_MIN_SUBSCRIBERS, ICP_MAX_SUBSCRIBERS)
  );
}
