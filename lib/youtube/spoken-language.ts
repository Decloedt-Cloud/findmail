/** A real language choice is a short list. The full "all languages" set is not one. */
export function isSpecificLanguageChoice(codes: string[]): boolean {
  return codes.length > 0 && codes.length <= 6;
}

function languageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : null;
}

const FRENCH_WORDS = ["le", "la", "les", "des", "une", "pour", "avec", "dans", "qui", "vous", "cette", "nous", "pourquoi"];
const ENGLISH_WORDS = ["the", "and", "with", "your", "this", "from", "how", "what", "that"];

function wordHits(title: string, words: string[]): number {
  let hits = 0;
  for (const word of words) {
    if (new RegExp(`\\b${word}\\b`, "i").test(title)) hits += 1;
  }
  return hits;
}

/** Language of one title when YouTube did not store it. Accents win; two function words are enough. */
export function languageFromTitle(title: string): string | null {
  const text = title.trim().toLowerCase();
  if (!text) return null;
  if (/[àâçéèêëîïôùûüœæ]/.test(text)) return "fr";
  if (/[ąćęłńóśźż]/.test(text)) return "pl";
  if (/[äöüß]/.test(text)) return "de";
  if (/[áéíóúñ¿¡]/.test(text)) return "es";
  const french = wordHits(text, FRENCH_WORDS);
  const english = wordHits(text, ENGLISH_WORDS);
  if (french >= 2 && french > english) return "fr";
  if (english >= 2 && english > french) return "en";
  return null;
}

export type SpokenVideo = {
  title: string;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
};

/** Language of one video: YouTube's audio language, then the title. */
export function videoSpokenLanguage(video: SpokenVideo): string | null {
  return languageCode(video.defaultAudioLanguage) ?? languageCode(video.defaultLanguage) ?? languageFromTitle(video.title);
}

/**
 * Language a channel actually publishes in.
 * The majority of recent videos that have a language. No evidence is no language.
 */
export function channelSpokenLanguage(videos: SpokenVideo[]): string | null {
  const counts = new Map<string, number>();
  for (const video of videos) {
    const code = videoSpokenLanguage(video);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}
