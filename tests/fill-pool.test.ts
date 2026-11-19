import { describe, expect, it, vi } from "vitest";
import {
  FILL_NIGHT_UNITS,
  FILL_RUN_UNITS,
  fillRunBudget,
  fillWindowStart,
  inFillWindow,
  paceYouTubeFetch,
  selectFillNiche,
  stoppedByRateLimit,
  type FillNiche,
} from "@/lib/jobs/fill-pool";

function niche(partial: Partial<FillNiche> & Pick<FillNiche, "id">): FillNiche {
  return {
    label: partial.id,
    query: partial.id.toLowerCase(),
    usable: 0,
    lastFilledAt: null,
    ...partial,
  };
}

describe("nightly creator pool", () => {
  it("runs from 01:00 through 05:59", () => {
    expect(inFillWindow(new Date(2026, 10, 19, 0, 59))).toBe(false);
    expect(inFillWindow(new Date(2026, 10, 19, 1, 0))).toBe(true);
    expect(inFillWindow(new Date(2026, 10, 19, 5, 30))).toBe(true);
    expect(inFillWindow(new Date(2026, 10, 19, 6, 0))).toBe(false);
    expect(inFillWindow(new Date(2026, 10, 19, 16, 30))).toBe(false);
  });

  it("anchors the night budget at 01:00", () => {
    expect(fillWindowStart(new Date(2026, 10, 19, 3, 15)).getHours()).toBe(1);
    const before = fillWindowStart(new Date(2026, 10, 19, 0, 30));
    expect(before.getDate()).toBe(18);
    expect(before.getHours()).toBe(1);
  });

  it("caps one pass at 800 and the night at 4000", () => {
    expect(fillRunBudget(0, 9000)).toBe(FILL_RUN_UNITS);
    expect(fillRunBudget(3500, 9000)).toBe(500);
    expect(fillRunBudget(FILL_NIGHT_UNITS, 9000)).toBe(0);
    expect(fillRunBudget(0, 200)).toBe(200);
    expect(fillRunBudget(0, 50)).toBe(0);
  });

  it("picks the thinnest category, then the one filled longest ago", () => {
    const chosen = selectFillNiche([
      niche({ id: "BEAUTY", usable: 4, lastFilledAt: 10 }),
      niche({ id: "FINTECH", usable: 1, lastFilledAt: 20 }),
      niche({ id: "FOOD", usable: 1, lastFilledAt: null }),
    ]);
    expect(chosen?.id).toBe("FOOD");
  });

  it("stops the night after a YouTube rate limit", () => {
    expect(stoppedByRateLimit([null, "YouTube Data API request failed (rateLimitExceeded)"])).toBe(true);
    expect(stoppedByRateLimit(["The nightly creator pool stopped at its unit cap."])).toBe(false);
  });

  it("waits between YouTube calls", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const paced = paceYouTubeFetch(fetchImpl, 3000);
    const first = paced("https://example.test/1");
    await vi.runAllTimersAsync();
    await first;
    const second = paced("https://example.test/2");
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
