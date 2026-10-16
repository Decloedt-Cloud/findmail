import type { YouTubeVideoDetails } from "@/lib/youtube/client";

export const AVERAGE_VIEWS_LIMIT = 10;

export const AVERAGE_VIEWS_METHOD =
  "Arithmetic mean of viewCount from videos.list, rounded to the nearest integer, using the 10 newest videos that playlistItems.list returned from the channel uploads playlist and that videos.list still lists as public with a numeric viewCount. Upcoming premieres are excluded. lastActiveAt is the publishedAt of the newest video in that retained set. A missing value stays null.";

export type RetainedVideo = {
  id: string;
  title: string;
  publishedAt: string;
  viewCount: number;
};

export function selectRecentPublicVideos(videos: YouTubeVideoDetails[], limit = AVERAGE_VIEWS_LIMIT) {
  const retained = videos
    .filter((video) => {
      if (!video.id || !video.publishedAt || video.viewCount == null) return false;
      if (video.privacyStatus && video.privacyStatus !== "public") return false;
      if (video.liveBroadcastContent === "upcoming") return false;
      return true;
    })
    .sort((left, right) => right.publishedAt!.localeCompare(left.publishedAt!))
    .slice(0, limit)
    .map((video) => ({
      id: video.id,
      title: video.title,
      publishedAt: video.publishedAt as string,
      viewCount: video.viewCount as number,
    }));
  if (retained.length === 0) {
    return { retained, averageViews: null as number | null, lastActiveAt: null as string | null };
  }
  const total = retained.reduce((sum, video) => sum + video.viewCount, 0);
  const average = Math.round(total / retained.length);
  return {
    retained,
    averageViews: average >= 0 && average <= 2_147_483_647 ? average : null,
    lastActiveAt: retained[0]?.publishedAt ?? null,
  };
}

export function fitViewCount(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 2_147_483_647) return null;
  return rounded;
}
