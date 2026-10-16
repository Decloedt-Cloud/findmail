import { extractEmailsFromText } from "@/lib/email/extract";
import { isSameSite } from "@/lib/email/normalize";
import { statusAfterSyntaxCheck } from "@/lib/email/status";
import { chooseOfficialWebsite, extractUrls } from "@/lib/email/website";
import type { EmailCandidate } from "@/lib/email/discovery";

export function extractPublicContacts(texts: string[]) {
  const text = texts.filter(Boolean).join("\n");
  const urls = extractUrls(text);
  const website = chooseOfficialWebsite(urls);
  const publishedWebsite = website.website ?? website.hubs[0] ?? null;
  const emails = extractEmailsFromText(text).map((email): EmailCandidate => ({
    emailAddress: email.normalized,
    normalizedEmail: email.normalized,
    sourceUrl: null,
    sourceType: "CHANNEL_DESCRIPTION",
    extractionMethod: "CHANNEL_DESCRIPTION",
    confidenceStatus: "MEDIUM",
    verificationStatus: statusAfterSyntaxCheck(true, false),
    isOnOfficialDomain: website.website ? isSameSite(email.normalized, website.website) : false,
    isGenericInbox: email.genericInbox,
    pageTitle: null,
  }));
  return {
    email: emails[0]?.normalizedEmail ?? null,
    emails,
    website: publishedWebsite,
    websiteEvidence: website.website
      ? website.evidence
      : publishedWebsite
        ? "The only non-social URL written in the public description is a link hub."
        : website.evidence,
    instagram: firstProfile(urls, ["instagram.com"]),
    twitter: firstProfile(urls, ["twitter.com", "x.com"]),
    tiktok: firstProfile(urls, ["tiktok.com"]),
  };
}

export function publicContactsFromDescriptions(parts: Array<{ text: string; sourceUrl: string | null; video: boolean }>) {
  const emails: EmailCandidate[] = [];
  const seen = new Set<string>();
  let website: string | null = null;
  let websiteEvidence = "No official website was found in the public descriptions returned by YouTube.";
  let instagram: string | null = null;
  let twitter: string | null = null;
  let tiktok: string | null = null;
  for (const part of parts) {
    if (!part.text.trim()) continue;
    const found = extractPublicContacts([part.text]);
    if (!website && found.website) {
      website = found.website;
      websiteEvidence = part.video
        ? "The website URL was written in a public video description returned by the YouTube Data API."
        : "The website URL was written in a public channel or matched-video description returned by the YouTube Data API.";
    }
    instagram ??= found.instagram;
    twitter ??= found.twitter;
    tiktok ??= found.tiktok;
    for (const email of found.emails) {
      if (seen.has(email.normalizedEmail)) continue;
      seen.add(email.normalizedEmail);
      if (part.video) {
        email.sourceType = "PUBLIC_PAGE";
        email.extractionMethod = "VISIBLE_TEXT";
      }
      email.sourceUrl = part.sourceUrl;
      emails.push(email);
    }
  }
  return { emails, website, websiteEvidence, instagram, twitter, tiktok };
}

function firstProfile(urls: string[], hosts: string[]) {
  for (const value of urls) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!hosts.some((item) => host === item || host.endsWith(`.${item}`))) continue;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    if (segments[0] === "share" || segments[0] === "intent" || segments[0] === "home") continue;
    url.search = "";
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  }
  return null;
}
