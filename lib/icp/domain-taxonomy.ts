export const DOMAIN_TAXONOMY_VERSION = 1;

/** Canonical, stable paths. Additions are compatible; renames require a version bump. */
export const DOMAIN_PATHS = [
  "fashion/apparel/streetwear",
  "fashion/apparel/luxury",
  "fashion/apparel/modest-fashion",
  "fashion/apparel/general",
  "fashion/accessories/jewelry",
  "fashion/accessories/bags",
  "fashion/footwear/general",
  "fashion/styling/general",
  "beauty/skincare/general",
  "beauty/makeup/general",
  "beauty/haircare/general",
  "health/medicine/general",
  "health/mental-health/general",
  "health/wellness/general",
  "fitness/training/general",
  "fitness/nutrition/general",
  "food/cooking/general",
  "food/restaurants/general",
  "travel/destinations/general",
  "travel/hospitality/general",
  "technology/software/general",
  "technology/artificial-intelligence/general",
  "technology/consumer-electronics/general",
  "technology/cameras/general",
  "business/entrepreneurship/general",
  "business/marketing/general",
  "business/ecommerce/general",
  "finance/personal-finance/general",
  "finance/investing/general",
  "education/learning/general",
  "education/languages/general",
  "gaming/video-games/general",
  "entertainment/film-tv/general",
  "entertainment/music/general",
  "home/interior-design/general",
  "home/diy/general",
  "automotive/cars/general",
  "parenting/family/general",
  "pets/animal-care/general",
  "sports/general/general",
  "arts/photography/general",
  "arts/design/general",
  "science/general/general",
  "environment/sustainability/general",
] as const;

const DOMAIN_PATH_SET = new Set<string>(DOMAIN_PATHS);

export function isDomainPath(value: unknown): value is string {
  return typeof value === "string" && DOMAIN_PATH_SET.has(value);
}

export function domainTaxonomyPrompt() {
  return DOMAIN_PATHS.join("\n");
}

/** Same leaf, or a path inside the same top-level and second-level branch. */
export function domainRelationship(
  advertiserPath: string,
  channelPath: string,
): "same_domain" | "direct_subdomain" | "adjacent" | "unrelated" {
  if (advertiserPath === channelPath) return "same_domain";
  const advertiser = advertiserPath.split("/");
  const channel = channelPath.split("/");
  if (advertiser[0] === channel[0] && advertiser[1] === channel[1]) return "direct_subdomain";
  if (advertiser[0] === channel[0]) return "adjacent";
  return "unrelated";
}
