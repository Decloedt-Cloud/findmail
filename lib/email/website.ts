const SOCIAL_HOSTS = [
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "discord.gg",
  "discord.com",
  "twitch.tv",
  "linkedin.com",
  "reddit.com",
  "patreon.com",
  "github.com",
  "t.me",
  "telegram.me",
  "wa.me",
  "pinterest.com",
  "snapchat.com",
  "threads.net",
  "bsky.app",
  "ko-fi.com",
  "buymeacoffee.com",
];

const HUB_HOSTS = [
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "bio.link",
  "solo.to",
  "campsite.bio",
  "stan.store",
  "hoo.be",
  "taplink.cc",
  "lnk.bio",
  "allmylinks.com",
  "carrd.co",
];

function hostOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchesHost(host: string, suffixes: string[]) {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>"'`)\]]+/gi) ?? [];
  const www = text.match(/\bwww\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"'`)\]]*)?/gi) ?? [];
  return [...matches, ...www.map((value) => `https://${value}`)]
    .map((value) => value.replace(/[.,;:!?]+$/, ""))
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function classifyUrl(value: string): "social" | "hub" | "website" | "invalid" {
  const host = hostOf(value);
  if (!host) return "invalid";
  if (matchesHost(host, SOCIAL_HOSTS)) return "social";
  if (matchesHost(host, HUB_HOSTS)) return "hub";
  return "website";
}

export function chooseOfficialWebsite(links: string[]) {
  const websites: string[] = [];
  const hubs: string[] = [];
  for (const link of links) {
    const kind = classifyUrl(link);
    if (kind === "website") websites.push(link);
    if (kind === "hub") hubs.push(link);
  }
  const website = websites[0] ?? null;
  const evidence = website
    ? websites.length === 1
      ? "Linked from the channel description or public channel links."
      : `First of ${websites.length} public links. Other links were not treated as the official website: ${websites.slice(1, 4).join(", ")}`
    : hubs.length > 0
      ? "Only a link hub was published. It was not stored as the official website."
      : "No official website was found in public channel metadata.";
  return { website, hubs, otherWebsites: websites.slice(1), evidence };
}

export const CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/business", "/partnerships", "/work-with-me"];

const CONTACT_LINK = /contact|about|partner|business|collab|sponsor|work-with|advertise/i;

export function contactLinksFromHtml(html: string, pageUrl: string) {
  const base = new URL(pageUrl);
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1] ?? "");
  const links: string[] = [];
  for (const href of hrefs) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (!CONTACT_LINK.test(href)) continue;
    try {
      const url = new URL(href, base);
      if (url.hostname !== base.hostname) continue;
      url.hash = "";
      links.push(url.toString());
    } catch {
      continue;
    }
  }
  return [...new Set(links)];
}

export function candidateContactUrls(websiteUrl: string, homepageHtml?: string) {
  const origin = new URL(websiteUrl);
  const seeded = CONTACT_PATHS.map((path) => new URL(path, origin).toString());
  const discovered = homepageHtml ? contactLinksFromHtml(homepageHtml, websiteUrl) : [];
  return [...new Set([websiteUrl, ...seeded, ...discovered])];
}

export function domainFromWebsite(websiteUrl: string) {
  return new URL(websiteUrl).hostname.replace(/^www\./, "").toLowerCase();
}
