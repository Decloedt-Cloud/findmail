import { extractEmailsFromHtml, extractEmailsFromText, pageTitle } from "@/lib/email/extract";
import { isSameSite } from "@/lib/email/normalize";
import { statusAfterSyntaxCheck, type EmailVerificationStatus } from "@/lib/email/status";
import { candidateContactUrls, chooseOfficialWebsite, domainFromWebsite, extractUrls } from "@/lib/email/website";
import { pathAllowedByRobots, parseRobots, type RobotRules } from "@/lib/robots";

export type PageFetchResult =
  | { ok: true; url: string; status: number; body: string }
  | { ok: false; url: string; error: string };

export type LicensedContact = { email: string; sourceUrl?: string | null };

export type EmailCandidate = {
  emailAddress: string;
  normalizedEmail: string;
  sourceUrl: string | null;
  sourceType: "PUBLIC_PAGE" | "MAILTO" | "CHANNEL_DESCRIPTION" | "LICENSED_PROVIDER";
  extractionMethod: "MAILTO_LINK" | "VISIBLE_TEXT" | "CHANNEL_DESCRIPTION" | "PROVIDER_API";
  confidenceStatus: "HIGH" | "MEDIUM" | "LOW" | "AMBIGUOUS";
  verificationStatus: EmailVerificationStatus;
  isOnOfficialDomain: boolean;
  isGenericInbox: boolean;
  pageTitle: string | null;
};

export type WebsiteDiscovery = {
  officialWebsiteUrl: string | null;
  websiteStatus: "FOUND" | "UNAVAILABLE";
  websiteEvidence: string;
  hubs: string[];
};

export class EmailDiscoveryService {
  constructor(
    private readonly options: {
      maxPages: number;
      fetchPage: (url: string) => Promise<PageFetchResult>;
      fetchText: (url: string) => Promise<PageFetchResult>;
      licensedLookup?: (domain: string) => Promise<LicensedContact[]>;
    },
  ) {}

  websiteFromMetadata(description: string, existingWebsite?: string | null): WebsiteDiscovery {
    const links = extractUrls(`${description}\n${existingWebsite ?? ""}`);
    const chosen = chooseOfficialWebsite(links);
    return {
      officialWebsiteUrl: chosen.website,
      websiteStatus: chosen.website ? "FOUND" : "UNAVAILABLE",
      websiteEvidence: chosen.evidence,
      hubs: chosen.hubs,
    };
  }

  async discover(input: {
    description: string | null;
    channelUrl: string;
    existingWebsite?: string | null;
  }): Promise<{ website: WebsiteDiscovery; emails: EmailCandidate[]; notes: string[] }> {
    const notes: string[] = [];
    const website = this.websiteFromMetadata(input.description ?? "", input.existingWebsite);
    const emails: EmailCandidate[] = [];

    for (const found of extractEmailsFromText(input.description ?? "")) {
      emails.push(
        this.toCandidate(found.original, found.method === "MAILTO_LINK" ? "MAILTO" : "CHANNEL_DESCRIPTION", "CHANNEL_DESCRIPTION", input.channelUrl, null, website.officialWebsiteUrl, found.genericInbox, false),
      );
    }

    const pagesToScan = [...website.hubs];
    if (website.officialWebsiteUrl) pagesToScan.push(website.officialWebsiteUrl);

    for (const startUrl of pagesToScan) {
      const scanned = await this.scanSite(startUrl, notes);
      for (const page of scanned) {
        const title = pageTitle(page.body);
        for (const found of extractEmailsFromHtml(page.body)) {
          emails.push(
            this.toCandidate(
              found.original,
              found.method === "MAILTO_LINK" ? "MAILTO" : "PUBLIC_PAGE",
              found.method,
              page.url,
              title,
              website.officialWebsiteUrl,
              found.genericInbox,
              found.method === "MAILTO_LINK",
            ),
          );
        }
      }
    }

    if (website.officialWebsiteUrl && this.options.licensedLookup) {
      try {
        const domain = domainFromWebsite(website.officialWebsiteUrl);
        const licensed = await this.options.licensedLookup(domain);
        for (const contact of licensed) {
          emails.push(
            this.toCandidate(contact.email, "LICENSED_PROVIDER", "PROVIDER_API", contact.sourceUrl ?? null, null, website.officialWebsiteUrl, false, false),
          );
        }
      } catch (error) {
        notes.push(error instanceof Error ? error.message : "Licensed contact provider failed");
      }
    }

    const deduped = this.dedupe(emails);
    const ambiguous = new Set(deduped.map((email) => email.normalizedEmail.split("@")[1])).size > 1;
    return {
      website,
      notes,
      emails: deduped.map((email) => ({
        ...email,
        verificationStatus: statusAfterSyntaxCheck(true, ambiguous && !email.isOnOfficialDomain),
        confidenceStatus: ambiguous && !email.isOnOfficialDomain ? "AMBIGUOUS" : email.confidenceStatus,
      })),
    };
  }

  private dedupe(emails: EmailCandidate[]) {
    const byAddress = new Map<string, EmailCandidate>();
    for (const email of emails) {
      const current = byAddress.get(email.normalizedEmail);
      if (!current || rank(email) > rank(current)) byAddress.set(email.normalizedEmail, email);
    }
    return [...byAddress.values()];
  }

  private toCandidate(
    address: string,
    sourceType: EmailCandidate["sourceType"],
    extractionMethod: EmailCandidate["extractionMethod"],
    sourceUrl: string | null,
    title: string | null,
    website: string | null,
    genericInbox: boolean,
    mailto: boolean,
  ): EmailCandidate {
    const normalized = address.trim().toLowerCase();
    const onDomain = isSameSite(normalized, website);
    return {
      emailAddress: normalized,
      normalizedEmail: normalized,
      sourceUrl,
      sourceType,
      extractionMethod,
      confidenceStatus: onDomain ? "HIGH" : mailto ? "MEDIUM" : "LOW",
      verificationStatus: "SYNTAX_VALID",
      isOnOfficialDomain: onDomain,
      isGenericInbox: genericInbox,
      pageTitle: title,
    };
  }

  private async scanSite(startUrl: string, notes: string[]) {
    let origin: URL;
    try {
      origin = new URL(startUrl);
    } catch {
      notes.push(`Skipped an invalid website URL`);
      return [];
    }
    const robotsUrl = `${origin.origin}/robots.txt`;
    const robotsResponse = await this.options.fetchText(robotsUrl);
    let rules: RobotRules = { allow: [], disallow: [] };
    if (!robotsResponse.ok) {
      if (!/404/.test(robotsResponse.error)) {
        notes.push(`Skipped ${origin.hostname} because robots.txt could not be read`);
        return [];
      }
    } else if (robotsResponse.status === 404) {
      rules = { allow: [], disallow: [] };
    } else if (robotsResponse.status >= 400) {
      notes.push(`Skipped ${origin.hostname} because robots.txt returned ${robotsResponse.status}`);
      return [];
    } else {
      rules = parseRobots(robotsResponse.body, "WayoAdsCreatorEmailFinder");
    }

    const pages: { url: string; body: string }[] = [];
    const homeAllowed = pathAllowedByRobots(origin.pathname || "/", rules);
    let homepage = "";
    if (homeAllowed) {
      const home = await this.options.fetchPage(origin.toString());
      if (home.ok && home.status < 400) {
        homepage = home.body;
        pages.push({ url: home.url, body: home.body });
      } else if (!home.ok) {
        notes.push(home.error);
      }
    } else {
      notes.push(`robots.txt disallows the homepage for ${origin.hostname}`);
    }

    const candidates = candidateContactUrls(origin.toString(), homepage).filter((url) => url !== origin.toString());
    for (const candidate of candidates) {
      if (pages.length >= this.options.maxPages) break;
      let path = "/";
      try {
        path = new URL(candidate).pathname;
      } catch {
        continue;
      }
      if (!pathAllowedByRobots(path, rules)) {
        notes.push(`robots.txt disallows ${path}`);
        continue;
      }
      const page = await this.options.fetchPage(candidate);
      if (!page.ok) {
        notes.push(page.error);
        continue;
      }
      if (page.status >= 400 || !page.body) continue;
      pages.push({ url: page.url, body: page.body });
    }
    return pages;
  }
}

function rank(email: EmailCandidate) {
  const confidence = { HIGH: 3, MEDIUM: 2, LOW: 1, AMBIGUOUS: 0 }[email.confidenceStatus];
  return confidence + (email.isOnOfficialDomain ? 2 : 0) + (email.extractionMethod === "MAILTO_LINK" ? 1 : 0);
}
