import { describe, expect, it } from "vitest";
import { icpSearchPausedUntil, youtubeQuotaDayStart } from "@/lib/youtube/quota-day";

describe("YouTube quota day", () => {
  it("starts at midnight Pacific, which is 08:00 UTC in November", () => {
    expect(youtubeQuotaDayStart(new Date("2026-11-20T14:51:00.000Z")).toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(youtubeQuotaDayStart(new Date("2026-11-20T07:59:00.000Z")).toISOString()).toBe("2026-11-19T08:00:00.000Z");
    expect(youtubeQuotaDayStart(new Date("2026-11-20T08:00:00.000Z")).toISOString()).toBe("2026-11-20T08:00:00.000Z");
  });

  it("uses midnight Pacific in summer time too", () => {
    expect(youtubeQuotaDayStart(new Date("2026-07-10T20:00:00.000Z")).toISOString()).toBe("2026-07-10T07:00:00.000Z");
  });

  it("starts counting at YOUTUBE_QUOTA_SINCE when it falls inside the current Pacific day", () => {
    const now = new Date("2026-11-20T14:51:00.000Z");
    expect(youtubeQuotaDayStart(now, "2026-11-20T12:20:00Z").toISOString()).toBe("2026-11-20T12:20:00.000Z");
  });

  it("ignores YOUTUBE_QUOTA_SINCE when it is before the day start or in the future", () => {
    const now = new Date("2026-11-20T14:51:00.000Z");
    expect(youtubeQuotaDayStart(now, "2026-11-19T12:00:00Z").toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(youtubeQuotaDayStart(now, "2026-11-20T23:00:00Z").toISOString()).toBe("2026-11-20T08:00:00.000Z");
    expect(youtubeQuotaDayStart(now, "not a date").toISOString()).toBe("2026-11-20T08:00:00.000Z");
  });

  it("reads the ICP pause from the environment", () => {
    expect(icpSearchPausedUntil("")).toBeNull();
    expect(icpSearchPausedUntil(undefined)).toBeNull();
    expect(icpSearchPausedUntil("not a date")).toBeNull();
    expect(icpSearchPausedUntil("2026-11-21T08:00:00Z")?.toISOString()).toBe("2026-11-21T08:00:00.000Z");
  });
});
