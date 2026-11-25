import { describe, expect, it } from "vitest";
import { readContentCountries } from "@/lib/youtube/content-country";
import { channelLanguageRead, channelSpokenLanguage, isSpecificLanguageChoice, languageFromTitle } from "@/lib/youtube/spoken-language";

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
    ])).toBe("fr");
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière" },
      { title: "Une journée dans notre studio" },
      { title: "How to grow on YouTube with this strategy" },
      { title: "What I bought this week" },
    ])).toBe("en,fr");
  });

  it("keeps a language from the description or the comments beside the titles", () => {
    expect(channelSpokenLanguage([
      { title: "iPhone 16", description: "Aujourd'hui je vous montre comment filmer avec cette lumière" },
      { title: "Episode 4", description: "Une journée dans notre studio pour tester ce micro" },
    ])).toBe("fr");
    expect(channelSpokenLanguage([
      { title: "How to grow on YouTube with this strategy", description: "Aujourd'hui je vous montre comment filmer avec cette lumière" },
      { title: "What I bought this week", description: "Une journée dans notre studio pour tester ce micro" },
    ])).toBe("en,fr");
    expect(channelSpokenLanguage([
      {
        title: "Episode 4",
        description: "GTX 4090",
        creatorComments: ["Merci pour cette vidéo"],
      },
    ])).toBe("fr");
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière", comments: ["This is the best video", "Love your channel"] },
      { title: "Une journée dans notre studio", comments: ["What a great video from the start"] },
    ])).toBe("fr");
    expect(channelSpokenLanguage([
      { title: "How to grow on YouTube with this strategy", creatorComments: ["Merci pour cette vidéo"] },
      { title: "What I bought this week" },
    ])).toBe("en,fr");
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière" },
      { title: "Une journée dans notre studio" },
      { title: "What I bought this week" },
    ])).toBe("en,fr");
    expect(channelSpokenLanguage([
      { title: "Comment filmer avec cette lumière" },
      { title: "What I bought this week" },
    ])).toBe("en,fr");
    expect(channelLanguageRead([
      { title: "Comment filmer avec cette lumière" },
      { title: "What I bought this week" },
    ]).conclusive).toBe(true);
    expect(channelLanguageRead([
      { title: "Episode 4" },
      { title: "iPhone 16" },
      { title: "GTX 4090" },
      { title: "Unboxing" },
    ]).conclusive).toBe(false);
    expect(channelLanguageRead(
      Array.from({ length: 12 }, () => ({ title: "Episode" })),
    ).conclusive).toBe(true);
  });

  it("reads a country the channel states, and ignores one passing mention", () => {
    expect(readContentCountries([
      { title: "", description: "Basée à Lyon. Vidéos chaque semaine.", about: true },
    ]).countries).toEqual(["FR"]);
    expect(readContentCountries([
      { title: "Vlog en France" },
    ]).countries).toEqual([]);
    expect(readContentCountries([
      { title: "Vlog en France" },
      { title: "Retour en France" },
    ]).countries).toEqual(["FR"]);
    expect(readContentCountries([
      { title: "Weekend in Paris" },
      { title: "Episode 4" },
    ]).countries).toEqual([]);
    expect(readContentCountries([
      { title: "Weekend in Liege" },
      { title: "Retour a Liege" },
    ]).countries).toEqual(["BE"]);
    expect(readContentCountries([
      { title: "Weekend in Paris" },
      { title: "Lunch in Lyon" },
    ]).countries).toEqual(["FR"]);
  });

  it("does not treat every language as a specific choice", () => {
    expect(isSpecificLanguageChoice([])).toBe(false);
    expect(isSpecificLanguageChoice(["fr"])).toBe(true);
    expect(isSpecificLanguageChoice(["fr", "en", "de", "es", "ar", "pt", "it"])).toBe(true);
  });
});
