import { describe, expect, it } from "vitest";
import { parseSearchQueries, publishedAfterIso, takeMatchingVideos } from "@/lib/icp/queries";

const now = new Date("2026-10-26T12:00:00.000Z");

describe("simplified ICP search queries", () => {
  it("keeps up to four distinct YouTube queries from DeepSeek JSON", () => {
    const parsed = parseSearchQueries(`\`\`\`json
{"queries":["saas onboarding tips","SaaS onboarding tips","cold email for founders","", "pipeline reviews for sales teams","extra query that should be dropped","sixth"],"note":"Audience watches B2B sales content."}
\`\`\``);
    expect(parsed.queries).toEqual([
      "saas onboarding tips",
      "cold email for founders",
      "pipeline reviews for sales teams",
      "extra query that should be dropped",
    ]);
    expect(parsed.note).toContain("B2B sales");
  });

  it("reads queries when the model uses another key", () => {
    const parsed = parseSearchQueries('{"search_queries":[{"query":"logiciel veterinaire clinique"},"gestion cabinet veterinaire"]}');
    expect(parsed.queries).toEqual(["logiciel veterinaire clinique", "gestion cabinet veterinaire"]);
  });

  it("rejects a reply that has no queries", () => {
    expect(() => parseSearchQueries('{"note":"nothing"}')).toThrow(/search queries/);
  });
});

describe("videos from the last six months", () => {
  it("stops at the remaining room and drops older or duplicate videos", () => {
    const cutoff = new Date(publishedAfterIso(now));
    const already = new Set(["old-kept"]);
    const picked = takeMatchingVideos(
      [
        { videoId: "old-kept", channelId: "UC1", title: "dup", description: "", publishedAt: "2026-08-01T00:00:00.000Z" },
        { videoId: "too-old", channelId: "UC2", title: "old", description: "", publishedAt: "2025-01-01T00:00:00.000Z" },
        { videoId: "no-date", channelId: "UC3", title: "undated", description: "" },
        { videoId: "v1", channelId: "UC4", title: "one", videoTitle: "First", description: "d1", publishedAt: "2026-06-01T00:00:00.000Z" },
        { videoId: "v2", channelId: "UC4", title: "two", description: "d2", publishedAt: "2026-09-01T00:00:00.000Z" },
      ],
      "saas onboarding",
      already,
      cutoff,
      1,
    );
    expect(picked).toEqual([
      {
        videoId: "v1",
        channelId: "UC4",
        title: "First",
        description: "d1",
        publishedAt: "2026-06-01T00:00:00.000Z",
        searchQuery: "saas onboarding",
      },
    ]);
    expect(cutoff.toISOString()).toBe("2026-04-26T12:00:00.000Z");
  });
});
