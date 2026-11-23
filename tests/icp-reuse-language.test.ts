import { describe, expect, it } from "vitest";
import { languageReuseFilter } from "@/lib/icp/reuse";

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
