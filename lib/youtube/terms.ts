const STOP_WORDS = new Set([
  "et", "and", "de", "the", "des", "du", "la", "le", "les", "un", "une",
  "of", "for", "a", "an", "ou", "or", "en", "au", "aux", "d", "l", "y",
  "à", "with", "pour", "sur", "dans", "in", "on", "to",
]);

const QUERY_ALIASES: Record<string, string[]> = {
  fashion: ["clothing"],
  beauty: ["skincare", "makeup"],
  skincare: ["makeup", "beauty"],
  software: ["saas"],
  food: ["cooking"],
  wellness: ["health"],
  fitness: ["workout"],
  "home decor": ["interior"],
  travel: ["tourism"],
  finance: ["investing"],
  fintech: ["neobank", "open banking"],
  gaming: ["gamer"],
  cars: ["automotive"],
  pets: ["animals"],
  ecommerce: ["online store"],
  nonprofit: ["charity"],
  "real estate": ["property"],
  crypto: ["blockchain"],
  photography: ["photographer"],
  music: ["musician"],
  diy: ["crafts"],
  sustainability: ["environment"],
};

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
  fintech: ["néobanque", "banque en ligne"],
  fashion: ["mode"],
  skincare: ["beauté"],
  software: ["logiciel"],
  wellness: ["santé"],
  "home decor": ["décoration"],
  travel: ["voyage"],
  finance: ["bourse"],
  education: ["éducation"],
  entertainment: ["divertissement"],
  gaming: ["jeu vidéo"],
  cars: ["voiture"],
  pets: ["animaux"],
  parenting: ["parentalité"],
  ecommerce: ["boutique en ligne"],
  nonprofit: ["bénévolat"],
  "real estate": ["immobilier"],
  crypto: ["cryptomonnaie"],
  photography: ["photographie"],
  music: ["musique"],
  diy: ["bricolage"],
  sustainability: ["écologie"],
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
  const french = country.toUpperCase() === "FR";
  for (const base of [...queries]) {
    const aliases = [
      ...(QUERY_ALIASES[base.toLowerCase()] ?? []),
      ...(french ? FR_QUERY_ALIASES[base.toLowerCase()] ?? [] : []),
    ];
    for (const alias of aliases) {
      if (!queries.some((query) => query.toLowerCase() === alias.toLowerCase())) queries.push(alias);
    }
  }
  return queries;
}

export function reuseLimit(maxResults: number) {
  return Math.floor(Math.max(0, maxResults) / 2);
}
