import { describe, expect, it } from "vitest";
import { channelSpokenLanguage, isSpecificLanguageChoice, languageFromTitle } from "@/lib/youtube/spoken-language";

describe("spoken language", () => {
  it("reads a language from the title", () => {
    expect(languageFromTitle("Ma routine du matin pour une peau saine")).toBe("fr");
    expect(languageFromTitle("How to grow on YouTube with this strategy")).toBe("en");
    expect(languageFromTitle("Cómo preparar una tarta para niños")).toBe("es");
    expect(languageFromTitle("Wie ich mein Zimmer eingerichtet habe")).toBe("de");
    expect(languageFromTitle("مراجعة أفضل كاميرا للمبتدئين")).toBe("ar");
    expect(languageFromTitle("Najlepsze triki na łowienie")).toBe("pl");
    expect(languageFromTitle("iPhone 16 unboxing")).toBeNull();
  });

  it("keeps a channel whose recent titles agree", () => {
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière", defaultAudioLanguage: "en" },
      { title: "Une journée dans notre studio", defaultLanguage: "en" },
    ])).toBe("fr");
    expect(channelSpokenLanguage([
      { title: "Morning routine for your skin", defaultAudioLanguage: "fr" },
      { title: "What I bought this week", defaultLanguage: "fr" },
    ])).toBe("en");
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière" },
      { title: "iPhone 16 unboxing" },
    ])).toBeNull();
  });

  it("does not treat every language as a specific choice", () => {
    expect(isSpecificLanguageChoice([])).toBe(false);
    expect(isSpecificLanguageChoice(["fr"])).toBe(true);
    expect(isSpecificLanguageChoice(["fr", "en", "de", "es", "ar", "pt", "it"])).toBe(false);
  });
});
