import { describe, expect, it } from "vitest";
import { catalogCreatorIds, languageReuseFilter, sharesAdvertiserTopic } from "@/lib/icp/reuse";

describe("catalogCreatorIds", () => {
  it("keeps the model choice when it selected channels", () => {
    expect(catalogCreatorIds(["a", "b"], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("keeps nothing when the model kept none", () => {
    expect(catalogCreatorIds([], ["a", "b", "c"], 2)).toEqual([]);
  });
});

describe("sharesAdvertiserTopic", () => {
  it("keeps a channel that talks about the site topic", () => {
    expect(
      sharesAdvertiserTopic(
        "veterinary clinics managing patient records",
        "Veterinary medicine for clinic owners and their patients",
      ),
    ).toBe(true);
  });

  it("rejects a channel whose only shared words are generic", () => {
    expect(
      sharesAdvertiserTopic(
        "veterinary clinics managing patient records",
        "Best lifestyle videos and business marketing tips",
      ),
    ).toBe(false);
  });
});

describe("languageReuseFilter", () => {
  it("does not filter when no language was chosen", () => {
    expect(languageReuseFilter([])).toBeNull();
    expect(languageReuseFilter(["", "  "])).toBeNull();
  });

  it("keeps an unknown language and a regional variant of the requested one", () => {
    expect(languageReuseFilter(["en", "EN"])).toEqual({
      OR: [
        { language: null },
        { language: "" },
        { language: { equals: "en", mode: "insensitive" } },
        { language: { startsWith: "en-", mode: "insensitive" } },
      ],
    });
  });
});
