/** Wayo Ads countries a Discover search can target. Same set as the campaign country field. */
export const DISCOVERY_COUNTRY_CODES = [
  "US", "ID", "BR", "MX", "JP", "TR", "EG", "TH", "KR", "AR", "CA", "CO", "AU",
  "AE", "BH", "KW", "OM", "QA", "SA",
  "DZ", "LY", "MA", "TN",
  "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GB", "GE", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD",
  "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SK", "SM", "UA",
  "XK",
] as const;

/**
 * Wayo campaign categories, without Other.
 * `query` is the one YouTube phrase used to find channels in that vertical.
 */
export const DISCOVERY_NICHES = [
  { id: "FASHION_APPAREL", label: "Fashion & apparel", query: "fashion" },
  { id: "BEAUTY_PERSONAL_CARE", label: "Beauty & personal care", query: "skincare" },
  { id: "TECH_SOFTWARE_ELECTRONICS", label: "Tech, software & electronics", query: "software" },
  { id: "FOOD_BEVERAGE", label: "Food & beverage", query: "food" },
  { id: "HEALTH_WELLNESS", label: "Health & wellness", query: "wellness" },
  { id: "FITNESS_SPORTS", label: "Fitness & sports", query: "fitness" },
  { id: "HOME_LIVING", label: "Home & living", query: "home decor" },
  { id: "TRAVEL_HOSPITALITY", label: "Travel & hospitality", query: "travel" },
  { id: "FINANCE_INSURANCE", label: "Finance & insurance", query: "finance" },
  { id: "EDUCATION_LEARNING", label: "Education & learning", query: "education" },
  { id: "ENTERTAINMENT_MEDIA", label: "Entertainment & media", query: "entertainment" },
  { id: "GAMING_ESPORTS", label: "Gaming & esports", query: "gaming" },
  { id: "AUTOMOTIVE", label: "Automotive & mobility", query: "cars" },
  { id: "PETS_ANIMALS", label: "Pets & animals", query: "pets" },
  { id: "BABY_FAMILY", label: "Baby, kids & family", query: "parenting" },
  { id: "B2B_PROFESSIONAL", label: "B2B & professional services", query: "b2b" },
  { id: "ECOMMERCE_RETAIL", label: "E-commerce & retail", query: "ecommerce" },
  { id: "NONPROFIT_CAUSE", label: "Nonprofit & causes", query: "nonprofit" },
  { id: "REAL_ESTATE", label: "Real estate & property", query: "real estate" },
  { id: "CRYPTO_WEB3", label: "Crypto, Web3 & blockchain", query: "crypto" },
  { id: "ART_DESIGN_PHOTOGRAPHY", label: "Art, design & photography", query: "photography" },
  { id: "MUSIC_AUDIO", label: "Music & audio", query: "music" },
  { id: "LIFESTYLE_VLOGS", label: "Lifestyle & vlogs", query: "lifestyle" },
  { id: "DIY_CRAFTS", label: "DIY & crafts", query: "diy" },
  { id: "ENVIRONMENT_SUSTAINABILITY", label: "Environment & sustainability", query: "sustainability" },
] as const;

export type DiscoveryNicheId = (typeof DISCOVERY_NICHES)[number]["id"];

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export const DISCOVERY_COUNTRIES = DISCOVERY_COUNTRY_CODES.map((code) => ({
  code,
  name: countryNames.of(code) ?? code,
})).sort((a, b) => a.name.localeCompare(b.name, "en"));
