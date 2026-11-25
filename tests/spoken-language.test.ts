import { describe, expect, it } from "vitest";
import { channelSpokenLanguage, isSpecificLanguageChoice, languageFromTitle } from "@/lib/youtube/spoken-language";

describe("spoken language", () => {
  it("reads French from a title and English from another", () => {
    expect(languageFromTitle("Ma routine du matin pour une peau saine")).toBe("fr");
    expect(languageFromTitle("How to grow on YouTube with this strategy")).toBe("en");
    expect(languageFromTitle("Najlepsze triki na YouTube")).toBeNull();
  });

  it("keeps a channel whose recent videos are French and drops an English one", () => {
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière", defaultAudioLanguage: null },
      { title: "Une journée dans notre studio", defaultLanguage: "fr" },
    ])).toBe("fr");
    expect(channelSpokenLanguage([
      { title: "Morning routine for your skin", defaultAudioLanguage: "en" },
      { title: "What I bought this week", defaultLanguage: "en-US" },
    ])).toBe("en");
  });

  it("does not treat every language as a specific choice", () => {
    expect(isSpecificLanguageChoice([])).toBe(false);
    expect(isSpecificLanguageChoice(["fr"])).toBe(true);
    expect(isSpecificLanguageChoice(["fr", "en", "de", "es", "ar", "pt", "it"])).toBe(false);
  });
});
