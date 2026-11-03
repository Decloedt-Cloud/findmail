import { describe, expect, it } from "vitest";
import { hasEnoughViews, isRecentlyActive, needsActivityRecheck, qualifiesForStorage } from "@/lib/youtube/qualify";

const now = new Date("2026-10-28T12:00:00.000Z");

describe("channel storage filters", () => {
  it("keeps a channel that posted within two months", () => {
    expect(isRecentlyActive("2026-08-28T12:00:00.000Z", now)).toBe(true);
    expect(isRecentlyActive("2026-10-01T00:00:00.000Z", now)).toBe(true);
  });

  it("rejects a channel whose latest video is older than two months", () => {
    expect(isRecentlyActive("2026-08-27T12:00:00.000Z", now)).toBe(false);
    expect(isRecentlyActive(null, now)).toBe(false);
  });

  it("rejects public subscriber counts whose recent views are far lower", () => {
    expect(hasEnoughViews({ subscriberCount: 100_000, subscriberVisibility: "PUBLIC", averageViews: 300 })).toBe(false);
    expect(hasEnoughViews({ subscriberCount: 100_000, subscriberVisibility: "PUBLIC", averageViews: 2_000 })).toBe(true);
    expect(hasEnoughViews({ subscriberCount: 100_000, subscriberVisibility: "HIDDEN", averageViews: 10 })).toBe(true);
  });

  it("rereads a channel only when its last video is near the two-month line", () => {
    expect(needsActivityRecheck(new Date("2026-10-20T12:00:00.000Z"), now)).toBe(false);
    expect(needsActivityRecheck(new Date("2026-09-01T12:00:00.000Z"), now)).toBe(true);
    expect(needsActivityRecheck(null, now)).toBe(true);
  });

  it("requires both a recent video and enough views", () => {
    expect(qualifiesForStorage({
      lastActiveAt: "2026-10-01T00:00:00.000Z",
      subscriberCount: 50_000,
      subscriberVisibility: "PUBLIC",
      averageViews: 200,
      now,
    })).toBe(false);
    expect(qualifiesForStorage({
      lastActiveAt: "2026-10-01T00:00:00.000Z",
      subscriberCount: 50_000,
      subscriberVisibility: "PUBLIC",
      averageViews: 1_500,
      now,
    })).toBe(true);
  });
});
