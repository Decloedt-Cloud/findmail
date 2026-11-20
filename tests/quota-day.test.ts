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

  it("reads the ICP pause from the environment", () => {
    expect(icpSearchPausedUntil("")).toBeNull();
    expect(icpSearchPausedUntil(undefined)).toBeNull();
    expect(icpSearchPausedUntil("not a date")).toBeNull();
    expect(icpSearchPausedUntil("2026-11-21T08:00:00Z")?.toISOString()).toBe("2026-11-21T08:00:00.000Z");
  });
});
