export function icpHost(websiteUrl: string) {
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return websiteUrl.trim().toLowerCase().replace(/^www\./, "");
  }
}

/** Same brand on the same site, ignoring www and a trailing slash. */
export function icpIdentityKey(brandName: string, websiteUrl: string) {
  return `${brandName.trim().toLowerCase()}·${icpHost(websiteUrl)}`;
}

/** The site is the ICP. The advertiser name is only a fallback when the URL has no host. */
export function icpSiteLabel(websiteUrl: string | null | undefined, brandName = "") {
  const host = websiteUrl ? icpHost(websiteUrl) : "";
  return host || brandName.trim();
}

export function uniqueIcpsBySite<T extends { brandName: string; websiteUrl?: string | null }>(icps: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const icp of icps) {
    const key = icpSiteLabel(icp.websiteUrl, icp.brandName).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(icp);
  }
  return out;
}

export function uniqueIcpsByName<T extends { brandName: string }>(icps: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const icp of icps) {
    const key = icp.brandName.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(icp);
  }
  return out;
}

export function uniqueIcpOptions<T extends { brandName: string; websiteUrl: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const option of options) {
    const key = icpIdentityKey(option.brandName, option.websiteUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}
