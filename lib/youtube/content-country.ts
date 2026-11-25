/** A place the channel states. The about text counts at once. A video counts once, so one travel mention is not a country. */

const COUNTRIES: Array<[string, string[]]> = [
  ["FR", ["france", "فرنسا"]],
  ["DE", ["germany", "deutschland", "allemagne"]],
  ["GB", ["united kingdom", "great britain", "england", "royaume uni"]],
  ["ES", ["spain", "espana", "espagne"]],
  ["IT", ["italy", "italia", "italie"]],
  ["US", ["united states", "usa", "etats unis"]],
  ["CA", ["canada"]],
  ["MA", ["morocco", "maroc", "المغرب"]],
  ["DZ", ["algeria", "algerie", "الجزائر"]],
  ["TN", ["tunisia", "tunisie", "تونس"]],
  ["AE", ["united arab emirates", "emirats", "الإمارات"]],
  ["SA", ["saudi arabia", "arabie saoudite"]],
  ["BE", ["belgium", "belgique"]],
  ["NL", ["netherlands", "holland", "pays bas"]],
  ["PL", ["poland", "pologne"]],
  ["PT", ["portugal"]],
  ["CH", ["switzerland", "suisse", "schweiz"]],
  ["AT", ["austria", "autriche", "osterreich"]],
  ["SE", ["sweden", "suede", "sverige"]],
  ["NO", ["norway", "norvege", "norge"]],
  ["DK", ["denmark", "danemark", "danmark"]],
  ["FI", ["finland", "finlande", "suomi"]],
  ["IE", ["ireland", "irlande"]],
  ["GR", ["greece", "grece"]],
  ["RO", ["romania", "roumanie"]],
  ["CZ", ["czechia", "czech republic", "republique tcheque"]],
  ["HU", ["hungary", "hongrie"]],
  ["UA", ["ukraine"]],
  ["EG", ["egypt", "egypte"]],
  ["QA", ["qatar"]],
  ["KW", ["kuwait", "koweit"]],
  ["BH", ["bahrain", "bahrein"]],
  ["OM", ["oman"]],
];

const CITIES: Array<[string, string[]]> = [
  ["FR", ["paris", "lyon", "marseille", "toulouse", "bordeaux", "lille", "nantes", "strasbourg", "montpellier", "rennes", "grenoble", "reims", "toulon", "dijon", "angers", "nimes", "avignon", "tours", "clermont", "limoges", "amiens", "metz", "orleans", "caen", "rouen", "perpignan", "besancon", "versailles", "cannes", "annecy", "brest", "باريس"]],
  ["DE", ["berlin", "munich", "hamburg", "frankfurt", "cologne", "koln", "stuttgart", "dusseldorf", "leipzig", "dortmund", "dresden", "hannover", "bremen", "nuremberg", "nurnberg", "essen", "bonn"]],
  ["GB", ["london", "manchester", "birmingham", "leeds", "glasgow", "liverpool", "bristol", "edinburgh", "cardiff", "belfast", "nottingham", "sheffield", "leicester"]],
  ["ES", ["madrid", "barcelona", "barcelone", "valencia", "seville", "sevilla", "malaga", "bilbao", "zaragoza", "murcia", "alicante", "palma"]],
  ["IT", ["rome", "roma", "milan", "milano", "naples", "napoli", "turin", "torino", "florence", "firenze", "bologna", "palermo", "genoa", "genova", "venice", "venezia", "verona"]],
  ["US", ["new york", "los angeles", "chicago", "houston", "phoenix", "philadelphia", "san diego", "dallas", "austin", "miami", "atlanta", "boston", "seattle", "denver", "minneapolis", "detroit", "portland", "nashville", "orlando"]],
  ["CA", ["toronto", "montreal", "vancouver", "calgary", "ottawa", "edmonton", "quebec", "winnipeg"]],
  ["MA", ["casablanca", "rabat", "marrakech", "marrakesh", "fes", "tangier", "tanger", "agadir", "meknes", "oujda", "kenitra", "tetouan", "nador", "essaouira", "safi"]],
  ["DZ", ["algiers", "alger", "oran", "constantine"]],
  ["TN", ["tunis", "sfax", "sousse"]],
  ["AE", ["dubai", "abu dhabi", "sharjah"]],
  ["SA", ["riyadh", "jeddah", "dammam"]],
  ["BE", ["brussels", "bruxelles", "antwerp", "anvers", "ghent", "gand", "liege", "charleroi"]],
  ["NL", ["amsterdam", "rotterdam", "the hague", "la haye", "utrecht", "eindhoven"]],
  ["PL", ["warsaw", "varsovie", "krakow", "cracow", "lodz", "wroclaw", "poznan", "gdansk"]],
  ["PT", ["lisbon", "lisbonne", "lisboa", "porto", "braga", "coimbra"]],
  ["CH", ["zurich", "geneva", "geneve", "bern", "berne", "basel", "bale", "lausanne"]],
  ["AT", ["vienna", "wien"]],
  ["SE", ["stockholm"]],
  ["NO", ["oslo"]],
  ["DK", ["copenhagen"]],
  ["FI", ["helsinki"]],
  ["IE", ["dublin"]],
  ["GR", ["athens", "athenes"]],
  ["RO", ["bucharest", "bucarest"]],
  ["CZ", ["prague", "praga"]],
  ["HU", ["budapest"]],
  ["UA", ["kyiv", "kiev"]],
  ["EG", ["cairo", "le caire"]],
  ["QA", ["doha"]],
  ["KW", ["kuwait city"]],
  ["OM", ["muscat"]],
];

export type PlaceText = {
  title: string;
  description?: string | null;
  /** The channel's about text. One place there is the channel's country. */
  about?: boolean;
};

function fold(text: string): string {
  return text
    .replace(/['’]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function placesIn(text: string): Array<{ code: string; weight: number }> {
  const folded = fold(text);
  const found = new Map<string, number>();
  const consider = (rows: Array<[string, string[]]>, weight: number) => {
    for (const [code, names] of rows) {
      for (const name of names) {
        const needle = fold(name);
        if (!needle) continue;
        const hit = needle.includes(" ")
          ? folded.includes(needle)
          : new RegExp(`(?:^|[^a-z\\u0600-\\u06ff])${needle}(?:[^a-z\\u0600-\\u06ff]|$)`).test(folded);
        if (hit) found.set(code, Math.max(found.get(code) ?? 0, weight));
      }
    }
  };
  consider(CITIES, 1);
  consider(COUNTRIES, 1);
  return [...found.entries()].map(([code, weight]) => ({ code, weight }));
}

/** ISO codes the texts place the channel in, joined later by the caller. */
export function readContentCountries(videos: PlaceText[]): { countries: string[]; conclusive: boolean } {
  const weight = new Map<string, number>();
  let examined = 0;
  for (const video of videos) {
    const title = video.title.trim();
    const description = (video.description ?? "").trim();
    if (title) examined += 1;
    if (description) examined += 1;
    for (const hit of placesIn(`${title} ${description}`)) {
      const gain = video.about ? Math.max(hit.weight, 2) : hit.weight;
      weight.set(hit.code, (weight.get(hit.code) ?? 0) + gain);
    }
  }
  const countries = [...weight.entries()]
    .filter(([, count]) => count >= 2)
    .map(([code]) => code)
    .sort();
  return { countries, conclusive: countries.length > 0 || examined >= 4 };
}

export function contentCountryList(countries: string[]): string | null {
  const codes = [...new Set(countries.map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)))].sort();
  return codes.length > 0 ? codes.join(",") : null;
}

/** True when a stored list (`FR` or `FR,MA`) contains one requested code. */
export function storedCountriesCover(stored: string | null | undefined, requested: string[]): boolean {
  if (!stored || requested.length === 0) return false;
  const wanted = new Set(requested.map((code) => code.trim().toUpperCase()));
  return stored
    .toUpperCase()
    .split(/[^A-Z]+/)
    .some((code) => code.length === 2 && wanted.has(code));
}
