/** A real language choice is a short list. The full "all languages" set is not one. */
export function isSpecificLanguageChoice(codes: string[]): boolean {
  return codes.length > 0 && codes.length <= 6;
}

function languageCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : null;
}

type WordScore = { lang: string; points: number };

const WORDS = new Map<string, WordScore[]>();

function addWords(lang: string, points: number, words: string[]) {
  for (const word of words) {
    const row = WORDS.get(word) ?? [];
    row.push({ lang, points });
    WORDS.set(word, row);
  }
}

addWords("fr", 2, ["pour", "avec", "dans", "vous", "cette", "nous", "pourquoi", "chez", "aussi", "cest", "sont", "comment", "votre", "notre", "plus", "mais", "une", "les", "des", "est", "pas", "sur", "aux", "tout", "bien", "fait", "suis", "mon", "ton", "son", "qui"]);
addWords("fr", 1, ["que"]);
addWords("es", 1, ["que"]);
addWords("pt", 1, ["que"]);
addWords("en", 2, ["the", "your", "what", "with", "this", "from", "about", "that", "have", "just", "how"]);
addWords("en", 1, ["and", "for", "you", "are", "was", "not", "but", "our", "when", "why", "can", "will", "its", "new", "best"]);
addWords("es", 2, ["tambien", "porque", "esta", "estan", "como", "los", "las", "mas", "hay", "ninos"]);
addWords("es", 1, ["para", "con", "una", "por", "del", "este", "muy", "pero", "todo", "sus"]);
addWords("pt", 2, ["nao", "voce", "tambem", "estao", "obrigado", "sao", "numa"]);
addWords("pt", 1, ["para", "com", "uma", "por", "mais", "dos", "das", "seu", "sua", "muito", "mas", "como", "ela", "ele"]);
addWords("it", 2, ["perche", "questo", "questa", "degli", "delle", "anche", "piu", "sono", "nella", "sulla", "quando", "della"]);
addWords("it", 1, ["che", "non", "per", "con", "una", "come", "tutto", "molto", "del"]);
addWords("de", 2, ["nicht", "fur", "und", "eine", "ich", "das", "auf", "ist", "sich", "auch", "ein"]);
addWords("de", 1, ["der", "die", "mit", "von", "den", "dem", "wie", "wir", "sie", "zum"]);
addWords("nl", 2, ["niet", "het", "een", "deze", "wordt", "naar", "voor", "zijn", "geen"]);
addWords("nl", 1, ["van", "met", "dat", "ook", "maar", "wat", "over", "aan", "bij", "uit", "nog"]);
addWords("pl", 2, ["sie", "jest", "tylko", "przez", "dlaczego", "ktory", "ktora", "tego", "zeby", "oraz"]);
addWords("pl", 1, ["nie", "jak", "ale", "czy", "dla", "juz", "tym", "jego"]);
addWords("tr", 2, ["icin", "degil", "cok", "gibi", "olarak", "bunu", "daha"]);
addWords("tr", 1, ["bir", "ile", "ama", "olan", "her"]);
addWords("id", 2, ["yang", "untuk", "dengan", "tidak", "adalah", "kami", "saya"]);
addWords("id", 1, ["dan", "ini", "dari", "ada", "atau", "juga", "pada", "itu", "akan"]);

function fold(text: string): string {
  return text
    .replace(/['’]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function scriptLanguage(text: string): string | null {
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0;
  if (count(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF]/g) >= 2) return "ar";
  if (count(/[\u0900-\u097F]/g) >= 2) return "hi";
  if (count(/[\uAC00-\uD7AF]/g) >= 2) return "ko";
  if (count(/[\u3040-\u30FF]/g) >= 2) return "ja";
  if (count(/[\u0400-\u04FF]/g) >= 2) return "ru";
  if (count(/[\u4E00-\u9FFF]/g) >= 2) return "zh";
  return null;
}

function letterScores(text: string, scores: Map<string, number>) {
  const add = (lang: string, points: number) => scores.set(lang, (scores.get(lang) ?? 0) + points);
  if (/[àùûîœæ]/i.test(text)) add("fr", 2);
  if (/[èêëï]/i.test(text)) add("fr", 1);
  if (/ñ|¿|¡/i.test(text)) add("es", 3);
  if (/[ãõ]/i.test(text)) add("pt", 3);
  if (/[ąćęłńśźż]/i.test(text)) add("pl", 3);
  if (/ß/.test(text)) add("de", 3);
  if (/[äö]/i.test(text)) add("de", 2);
  if (/[ğış]/i.test(text)) add("tr", 3);
  if (/ü/i.test(text)) {
    add("de", 1);
    add("tr", 1);
  }
}

function winner(scores: Map<string, number>): string | null {
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const [lang, score] of scores) {
    if (score > bestScore) {
      second = bestScore;
      best = lang;
      bestScore = score;
    } else if (score > second) second = score;
  }
  if (!best || bestScore < 2 || bestScore <= second) return null;
  return best;
}

/**
 * Language of one title. A unique script is enough. Otherwise accents and
 * function words are scored, and a title counts only when one language leads.
 */
export function languageFromTitle(title: string): string | null {
  const text = title.trim();
  if (!text) return null;
  const script = scriptLanguage(text);
  if (script) return script;
  const scores = new Map<string, number>();
  letterScores(text, scores);
  for (const token of fold(text).split(/[^a-z]+/).filter((word) => word.length >= 3)) {
    for (const hit of WORDS.get(token) ?? []) {
      scores.set(hit.lang, (scores.get(hit.lang) ?? 0) + hit.points);
    }
  }
  return winner(scores);
}

export type SpokenVideo = {
  title: string;
  defaultLanguage?: string | null;
  defaultAudioLanguage?: string | null;
};

/** Language of one video: the title first, then the language YouTube stored. */
export function videoSpokenLanguage(video: SpokenVideo): string | null {
  return languageFromTitle(video.title) ?? languageCode(video.defaultAudioLanguage) ?? languageCode(video.defaultLanguage);
}

/**
 * Language a channel publishes in, read from recent titles.
 * Two titles must agree, and one language must lead. One title, a tie, or
 * titles with no words we recognise is no language.
 */
export function channelSpokenLanguage(videos: SpokenVideo[]): string | null {
  const counts = new Map<string, number>();
  for (const video of videos) {
    const code = languageFromTitle(video.title);
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) tied = true;
  }
  if (!best || tied || bestCount < 2) return null;
  return best;
}
