import { describe, expect, it } from "vitest";
import { normalizeSearchLanguage, searchPhraseRule } from "@/lib/icp/search-language";

describe("creator search language", () => {
  it("keeps a two-letter code", () => {
    expect(normalizeSearchLanguage("FR")).toBe("fr");
    expect(normalizeSearchLanguage("fra")).toBeNull();
  });

  it("asks for phrases in the chosen language", () => {
    expect(searchPhraseRule("ar")).toContain('"ar"');
    expect(searchPhraseRule(null)).toContain("English");
  });
});
