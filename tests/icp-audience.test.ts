import { describe, expect, it } from "vitest";
import { icpSearchPlan, channelInRequestedRegion, regionSearchCodes, matchesIcpAudience } from "@/lib/icp/audience";

const channel = (country: string | null, subscriberCount: number | null, subscriberVisibility: "PUBLIC" | "HIDDEN" | "UNAVAILABLE" = "PUBLIC") => ({
  country,
  subscriberCount,
  subscriberVisibility,
});

describe("icpSearchPlan", () => {
  it("runs up to three distinct phrases for the global search", () => {
    const phrases = ["veterinary medicine", "clinic workflow", "veterinary software", "extra phrase"];
    const plan = icpSearchPlan(phrases);
    expect(plan).toHaveLength(3);
    expect(plan.map((item) => item.query)).toEqual([
      "veterinary medicine",
      "clinic workflow",
      "veterinary software",
    ]);
  });

  it("dedupes phrases case-insensitively", () => {
    const plan = icpSearchPlan(["Veterinary Medicine", "veterinary medicine", "clinic workflow"]);
    expect(plan).toHaveLength(2);
    expect(plan[0]?.query).toBe("Veterinary Medicine");
    expect(plan[1]?.query).toBe("clinic workflow");
  });
});

describe("matchesIcpAudience", () => {
  it("keeps a public channel inside the subscriber band and the regions", () => {
    expect(matchesIcpAudience(channel("FR", 5_000))).toBe(true);
    expect(matchesIcpAudience(channel("US", 1_000_000))).toBe(true);
    expect(matchesIcpAudience(channel("MA", 80_000))).toBe(true);
    expect(matchesIcpAudience(channel("AE", 250_000))).toBe(true);
  });

  it("drops channels outside the subscriber band, with a hidden count, or outside the regions", () => {
    expect(matchesIcpAudience(channel("FR", 4_999))).toBe(false);
    expect(matchesIcpAudience(channel("DE", 1_000_001))).toBe(false);
    expect(matchesIcpAudience(channel("CA", null, "HIDDEN"))).toBe(false);
    expect(matchesIcpAudience(channel(null, 20_000))).toBe(false);
    expect(matchesIcpAudience(channel("BR", 20_000))).toBe(false);
    expect(matchesIcpAudience(channel("JP", 20_000))).toBe(false);
  });
});

describe("channelInRequestedRegion", () => {
  it("keeps only a channel that publishes one of the requested countries", () => {
    expect(channelInRequestedRegion("FR", ["FR"])).toBe(true);
    expect(channelInRequestedRegion("fr", ["FR", "DE"])).toBe(true);
    expect(channelInRequestedRegion("US", ["FR", "DE"])).toBe(false);
    expect(channelInRequestedRegion(null, ["FR"])).toBe(false);
  });
});

describe("regionSearchCodes", () => {
  it("starts with the largest markets in the requested list", () => {
    expect(regionSearchCodes(["PL", "FR", "DE", "GB", "ES", "IT", "NL"])).toEqual(["FR", "DE", "GB", "ES"]);
  });
});
