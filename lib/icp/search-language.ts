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

/** ISO 639-1 codes the YouTube search should run in. */
export function normalizeSearchLanguages(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const item of raw) {
    const code = normalizeSearchLanguage(item);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

export function snapshotSearchLanguages(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const record = snapshot as { searchLanguages?: unknown; searchLanguage?: unknown };
  const listed = normalizeSearchLanguages(record.searchLanguages);
  if (listed.length) return listed;
  const one = normalizeSearchLanguage(record.searchLanguage);
  return one ? [one] : [];
}

/** The one line that tells the query writer which language the phrases are in. */
export function searchPhraseRule(language: string | null, extra: string[] = []): string {
  const list = normalizeSearchLanguages([...(language ? [language] : []), ...extra]);
  if (list.length === 0) {
    return "Write every search phrase in English, even when the ICP is written in another language.";
  }
  if (list.length === 1) {
    return `Write every search phrase in the language whose ISO 639-1 code is "${list[0]}", and in no other language.`;
  }
  return `Write the search phrases across these ISO 639-1 languages: ${list.join(", ")}. Use more than one of them.`;
}
