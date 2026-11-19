/** ISO 639-1 code the YouTube search should run in. Anything else is no choice. */
export function normalizeSearchLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

export function snapshotSearchLanguage(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  return normalizeSearchLanguage((snapshot as { searchLanguage?: unknown }).searchLanguage);
}

/** The one line that tells the query writer which language the phrases are in. */
export function searchPhraseRule(language: string | null): string {
  if (!language) {
    return "Write every search phrase in English, even when the ICP is written in another language.";
  }
  return `Write every search phrase in the language whose ISO 639-1 code is "${language}", and in no other language.`;
}
