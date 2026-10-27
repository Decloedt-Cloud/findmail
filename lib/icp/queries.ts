export const ICP_VIDEO_TARGET = 30;
export const ICP_QUERY_LIMIT = 4;

export type IcpSearchHit = {
  videoId?: string;
  channelId: string;
  title: string;
  videoTitle?: string;
  description: string;
  publishedAt?: string;
};

export type PickedIcpVideo = {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  publishedAt: string;
  searchQuery: string;
};

export function publishedAfterIso(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return cutoff.toISOString();
}

export function parseSearchQueries(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("DeepSeek did not return search queries.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error("DeepSeek did not return search queries.");
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const queries: string[] = [];
  const buckets = [record.queries, record.search_queries, record.searchQueries];
  for (const bucket of buckets) {
    const items = Array.isArray(bucket) ? bucket : typeof bucket === "string" ? [bucket] : [];
    for (const item of items) {
      const text = typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? String((item as { query?: unknown; q?: unknown }).query ?? (item as { q?: unknown }).q ?? "")
          : "";
      const query = text.replace(/\s+/g, " ").trim();
      const key = query.toLowerCase();
      if (query.length < 2 || query.length > 80 || seen.has(key)) continue;
      seen.add(key);
      queries.push(query);
      if (queries.length >= ICP_QUERY_LIMIT) break;
    }
    if (queries.length >= ICP_QUERY_LIMIT) break;
  }
  if (queries.length === 0) {
    throw new Error("DeepSeek did not return search queries.");
  }
  const note = typeof record.note === "string" ? record.note.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  return { queries, note };
}

export function takeMatchingVideos(
  hits: IcpSearchHit[],
  searchQuery: string,
  already: Set<string>,
  cutoff: Date,
  room: number,
) {
  const picked: PickedIcpVideo[] = [];
  for (const hit of hits) {
    if (picked.length >= room) break;
    if (!hit.videoId || !hit.channelId || already.has(hit.videoId)) continue;
    if (!hit.publishedAt) continue;
    const published = new Date(hit.publishedAt);
    if (Number.isNaN(published.getTime()) || published < cutoff) continue;
    already.add(hit.videoId);
    picked.push({
      videoId: hit.videoId,
      channelId: hit.channelId,
      title: (hit.videoTitle || hit.title || hit.videoId).slice(0, 300),
      description: hit.description.slice(0, 2000),
      publishedAt: published.toISOString(),
      searchQuery,
    });
  }
  return picked;
}
