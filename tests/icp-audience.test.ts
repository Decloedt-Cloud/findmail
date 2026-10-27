import { describe, expect, it } from "vitest";
import { icpSearchPlan, icpSearchQuery, matchesIcpAudience } from "@/lib/icp/audience";

const channel = (country: string | null, subscriberCount: number | null, subscriberVisibility: "PUBLIC" | "HIDDEN" | "UNAVAILABLE" = "PUBLIC") => ({
  country,
  subscriberCount,
  subscriberVisibility,
});

describe("icpSearchPlan", () => {
  it("uses only the broad audience phrase for the global search", () => {
    const phrases = ["logiciel veterinaire", "gestion clinique", "veterinary software"];
    const plan = icpSearchPlan(phrases);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.query).toBe(icpSearchQuery(phrases.slice(0, 1)));
    expect(plan[0]?.query).toBe("logiciel veterinaire");
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
