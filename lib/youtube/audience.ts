import { MAX_CREATOR_SUBSCRIBERS, MIN_CREATOR_SUBSCRIBERS } from "@/lib/constants";

export const DISCOVERY_AUDIENCES = [
  { id: "any", label: "Any", min: MIN_CREATOR_SUBSCRIBERS, max: MAX_CREATOR_SUBSCRIBERS },
  { id: "5-20", label: "5K–20K", min: MIN_CREATOR_SUBSCRIBERS, max: 20_000 },
  { id: "20-100", label: "20K–100K", min: 20_000, max: 100_000 },
  { id: "100-500", label: "100K–500K", min: 100_000, max: 500_000 },
  { id: "500+", label: "500K+", min: 500_000, max: MAX_CREATOR_SUBSCRIBERS },
] as const;

export type AudienceFocus = "small" | "mid" | "large" | "broad";

export type AudienceSearchPass = {
  type: "channel" | "video";
  order?: "date" | "viewCount";
};

// YouTube search cannot filter by subscriber count. The sort order decides which audience appears first.
export function audienceFocus(min?: number | null, max?: number | null): AudienceFocus {
  const floor = min ?? 0;
  const ceiling = max == null || max >= MAX_CREATOR_SUBSCRIBERS ? null : max;
  if (ceiling == null && floor < 100_000) return "broad";
  if (ceiling != null && ceiling <= 50_000) return "small";
  if (floor >= 100_000) return "large";
  if (ceiling != null && floor < 100_000) return "mid";
  if (floor >= 50_000) return "large";
  return "broad";
}

export function audienceSearchPasses(min?: number | null, max?: number | null): AudienceSearchPass[] {
  const focus = audienceFocus(min, max);
  if (focus === "small") return [{ type: "video", order: "date" }, { type: "video" }];
  if (focus === "mid") return [{ type: "video" }, { type: "video", order: "date" }];
  if (focus === "large") return [{ type: "video", order: "viewCount" }, { type: "channel" }];
  return [{ type: "channel" }, { type: "video" }];
}
