import { describe, expect, it } from "vitest";
import { catalogCreatorIds, languageReuseFilter } from "@/lib/icp/reuse";

describe("catalogCreatorIds", () => {
  it("keeps the model choice when it selected channels", () => {
    expect(catalogCreatorIds(["a", "b"], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
  });

  it("uses the stored channels when the model kept none", () => {
    expect(catalogCreatorIds([], ["a", "b", "c"], 2)).toEqual(["a", "b"]);
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
