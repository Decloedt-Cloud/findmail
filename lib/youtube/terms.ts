const STOP_WORDS = new Set([
  "et", "and", "de", "the", "des", "du", "la", "le", "les", "un", "une",
  "of", "for", "a", "an", "ou", "or", "en", "au", "aux", "d", "l", "y",
  "à", "with", "pour", "sur", "dans", "in", "on", "to",
]);

const FR_QUERY_ALIASES: Record<string, string[]> = {
  business: ["entrepreneur", "entreprise", "entrepreneuriat"],
  entrepreneur: ["entreprise", "entrepreneuriat"],
  entreprise: ["entrepreneur", "entrepreneuriat"],
  tech: ["technologie"],
  technology: ["technologie"],
  food: ["cuisine", "recette"],
  cooking: ["cuisine", "recette"],
  beauty: ["beauté", "maquillage"],
  makeup: ["beauté", "maquillage"],
  fitness: ["musculation"],
  workout: ["musculation"],
};

export function matchTerms(keyword: string) {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const useful = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  if (useful.length === 0) return [trimmed];
  if (useful.length < words.length) return useful;
  return [trimmed];
}

export function searchQueries(keyword: string, country: string) {
  const queries = [...matchTerms(keyword)];
  if (country.toUpperCase() !== "FR") return queries;
  for (const base of [...queries]) {
    for (const alias of FR_QUERY_ALIASES[base.toLowerCase()] ?? []) {
      if (!queries.some((query) => query.toLowerCase() === alias.toLowerCase())) queries.push(alias);
    }
  }
  return queries;
}

export function reuseLimit(maxResults: number) {
  return Math.floor(Math.max(0, maxResults) / 2);
}
