import { describe, expect, it } from "vitest";
import { wayoAdsIcpSchema } from "@/lib/schemas";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    onboardingId: "onb_1234",
    websiteUrl: "https://ada.test",
    brandName: "Ada",
    stage: "complex",
    requestId: "req_1234",
    icp: {
      icps: [
        {
          icpRef: "icp-1",
          name: "Ops leads",
          description: "x".repeat(900),
          interests: Array.from({ length: 20 }, (_, index) => `interest-${index}`),
          problems: [],
          goals: [],
          useCases: [],
          productCategories: [],
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Preprod spent two rounds of "search again" on a 400 because DeepSeek wrote
 * more than 500 characters. A long sentence must never cost the whole search.
 */
describe("Wayo Ads ICP payload", () => {
  it("clips overlong ICP text instead of refusing the request", () => {
    const parsed = wayoAdsIcpSchema.parse(payload());
    expect(parsed.icp.icps[0].description).toHaveLength(500);
  });

  it("keeps at most 12 entries of a list", () => {
    const parsed = wayoAdsIcpSchema.parse(payload());
    expect(parsed.icp.icps[0].interests).toHaveLength(12);
  });

  it("still refuses an unnamed ICP", () => {
    const body = payload();
    body.icp.icps[0].name = "   ";
    expect(wayoAdsIcpSchema.safeParse(body).success).toBe(false);
  });

  it("keeps the language the request asked the search to use", () => {
    const parsed = wayoAdsIcpSchema.parse(payload({ language: "fr" }));
    expect(parsed.language).toBe("fr");
  });

  it("defaults a plain search to a first round, not a search again", () => {
    const parsed = wayoAdsIcpSchema.parse(payload());
    expect(parsed.searchAgain).toBe(false);
  });
});
