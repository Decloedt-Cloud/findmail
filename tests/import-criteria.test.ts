import { describe, expect, it } from "vitest";
import { matchCriteriaPatch, needsMatchRead, type StoredMatchCriteria } from "@/lib/jobs/import-criteria";
import type { SpokenLanguageRead } from "@/lib/icp/confirm-spoken";

const settled: StoredMatchCriteria = {
  languageCheckedAt: new Date("2026-11-01T00:00:00.000Z"),
  languageReadVersion: 2,
  averageViews: 100,
  lastActiveAt: new Date("2026-11-01T00:00:00.000Z"),
  recentPublicVideos: [{ id: "v1", title: "Titre", description: "", publishedAt: null }],
  publishesLongForm: true,
  publishesShorts: false,
};

const spoken: SpokenLanguageRead = {
  language: "fr",
  conclusive: true,
  countries: "FR",
  averageViews: 400,
  lastActiveAt: "2026-11-20T00:00:00.000Z",
  publishesLongForm: true,
  publishesShorts: true,
  recentPublicVideos: [{ id: "v2", title: "Nouvelle", description: "Texte", publishedAt: "2026-11-20T00:00:00.000Z" }],
};

describe("CSV import match criteria", () => {
  it("reads a new channel and a channel missing any matching field", () => {
    expect(needsMatchRead(null)).toBe(true);
    expect(needsMatchRead(settled)).toBe(false);
    expect(needsMatchRead({ ...settled, recentPublicVideos: null })).toBe(true);
    expect(needsMatchRead({ ...settled, publishesLongForm: null, publishesShorts: null })).toBe(true);
    expect(needsMatchRead({ ...settled, languageReadVersion: 1 })).toBe(true);
  });

  it("stores the language, views, format, and recent videos from one read", () => {
    const patch = matchCriteriaPatch(spoken, true);
    expect(patch).toEqual(expect.objectContaining({
      language: "fr",
      languageReadVersion: 2,
      contentCountries: "FR",
      averageViews: 400,
      publishesLongForm: true,
      publishesShorts: true,
      recentPublicVideos: spoken.recentPublicVideos,
    }));
  });

  it("keeps a current language when the read only refreshes activity", () => {
    const patch = matchCriteriaPatch({ ...spoken, conclusive: false, language: "en" }, false);
    expect(patch).not.toHaveProperty("language");
    expect(patch).toEqual(expect.objectContaining({ averageViews: 400 }));
  });

  it("returns nothing when the read found no language and no activity", () => {
    expect(matchCriteriaPatch({
      language: null,
      conclusive: false,
      countries: null,
      averageViews: null,
      lastActiveAt: null,
      publishesLongForm: null,
      publishesShorts: null,
      recentPublicVideos: [],
    }, true)).toBeNull();
  });
});
