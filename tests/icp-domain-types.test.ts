import { describe, expect, it } from "vitest";
import { domainInputHash, readRecentPublicVideos } from "@/lib/icp/domain-types";
import { domainRelationship } from "@/lib/icp/domain-taxonomy";

describe("domainInputHash", () => {
  it("ignores search controls but changes with the business offer", () => {
    const base = {
      brandName: "Mode",
      websiteUrl: "https://example.com",
      snapshot: { offers: [{ name: "Streetwear" }], countries: ["FR"], searchLanguages: ["fr"] },
    };
    const sameBusiness = {
      ...base,
      snapshot: { offers: [{ name: "Streetwear" }], countries: ["MA"], searchLanguages: ["ar"] },
    };
    const changedBusiness = {
      ...base,
      snapshot: { offers: [{ name: "Camera lessons" }], countries: ["FR"] },
    };
    expect(domainInputHash(base)).toBe(domainInputHash(sameBusiness));
    expect(domainInputHash(base)).not.toBe(domainInputHash(changedBusiness));
  });
});

describe("domain taxonomy", () => {
  it("distinguishes direct branches from adjacent and unrelated domains", () => {
    expect(domainRelationship("fashion/apparel/general", "fashion/apparel/streetwear")).toBe("direct_subdomain");
    expect(domainRelationship("fashion/apparel/general", "fashion/styling/general")).toBe("adjacent");
    expect(domainRelationship("fashion/apparel/general", "travel/destinations/general")).toBe("unrelated");
  });
});

describe("recent video evidence", () => {
  it("keeps bounded public evidence fields", () => {
    expect(readRecentPublicVideos([
      { id: "v1", title: "Streetwear outfits", description: "How to style denim", publishedAt: "2026-01-01" },
      { id: "", title: "Missing id" },
    ])).toEqual([
      { id: "v1", title: "Streetwear outfits", description: "How to style denim", publishedAt: "2026-01-01" },
    ]);
  });
});
