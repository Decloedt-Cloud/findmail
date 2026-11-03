import { describe, expect, it } from "vitest";
import { assessEmail, isSameSite, normalizeEmail } from "@/lib/email/normalize";
import { extractEmailsFromHtml, extractEmailsFromText } from "@/lib/email/extract";
import { canTransitionEmailStatus, emailStatusLabel, statusAfterSyntaxCheck, statusFromVerificationResult, transitionEmailStatus } from "@/lib/email/status";
import { chooseOfficialWebsite, classifyUrl, extractUrls } from "@/lib/email/website";
import { hunterEmailsFromResponse, mapNeverBounceResult, mapZeroBounceStatus, verificationProviderFromEnv } from "@/lib/email/providers";
import { EmailDiscoveryService } from "@/lib/email/discovery";
import { channelOriginLabel, emailOriginLabel, pickPrimaryEmail, usablePublicEmails } from "@/lib/creators/email";

describe("email normalization", () => {
  it("normalizes case and mailto query strings", () => {
    expect(normalizeEmail("  Mailto:Hello@Brand.com?subject=Hi ")).toBe("hello@brand.com");
  });

  it("rejects placeholders and keeps generic business inboxes", () => {
    expect(assessEmail("youremail@example.com").placeholder).toBe(true);
    expect(assessEmail("logo@2x.png").validSyntax).toBe(false);
    const info = assessEmail("info@brand.com");
    expect(info.validSyntax).toBe(true);
    expect(info.placeholder).toBe(false);
    expect(info.genericInbox).toBe(true);
  });

  it("prefers a named address when a generic inbox is also published", () => {
    const primary = pickPrimaryEmail([
      { verificationStatus: "VERIFIED", confidenceStatus: "HIGH", isGenericInbox: true, normalizedEmail: "info@brand.com" },
      { verificationStatus: "SYNTAX_VALID", confidenceStatus: "MEDIUM", isGenericInbox: false, normalizedEmail: "ada@brand.com" },
    ]);
    expect(primary?.normalizedEmail).toBe("ada@brand.com");
  });

  it("keeps every needs-review address when none is verified", () => {
    const ranked = usablePublicEmails([
      { verificationStatus: "NEEDS_REVIEW", confidenceStatus: "LOW", isGenericInbox: true, normalizedEmail: "info@brand.com" },
      { verificationStatus: "NEEDS_REVIEW", confidenceStatus: "MEDIUM", isGenericInbox: false, normalizedEmail: "ada@brand.com" },
      { verificationStatus: "INVALID", confidenceStatus: "LOW", isGenericInbox: false, normalizedEmail: "old@brand.com" },
    ]);
    expect(ranked.map((email) => email.normalizedEmail)).toEqual(["ada@brand.com", "info@brand.com"]);
    expect(pickPrimaryEmail(ranked)?.normalizedEmail).toBe("ada@brand.com");
  });

  it("detects the official domain without treating syntax as deliverability", () => {
    expect(isSameSite("press@brand.com", "https://www.brand.com/about")).toBe(true);
    expect(isSameSite("press@gmail.com", "https://brand.com")).toBe(false);
  });
});

describe("email extraction", () => {
  it("reads mailto links and visible text, and drops examples", () => {
    const html = `<html><title>Contact</title><a href="mailto:partnerships@brand.com">Email</a><p>example@example.com</p><p>hello [at] brand [dot] com</p></html>`;
    const found = extractEmailsFromHtml(html).map((item) => item.normalized);
    expect(found).toContain("partnerships@brand.com");
    expect(found).toContain("hello@brand.com");
    expect(found).not.toContain("example@example.com");
  });

  it("does not invent an address from a name", () => {
    expect(extractEmailsFromText("Ada Lovelace makes AI videos")).toEqual([]);
  });
});

describe("email status", () => {
  it("keeps statuses distinct and blocks illegal jumps", () => {
    expect(statusAfterSyntaxCheck(true, false)).toBe("SYNTAX_VALID");
    expect(emailStatusLabel("SYNTAX_VALID")).toBe("Found");
    expect(emailStatusLabel("VERIFIED")).toBe("Verified");
    expect(channelOriginLabel("YOUTUBE_SEARCH")).toBe("YouTube search");
    expect(emailOriginLabel("CHANNEL_DESCRIPTION")).toBe("Channel description");
    expect(emailOriginLabel("MAILTO")).toBe("Mailto link");
    expect(statusFromVerificationResult("valid")).toBe("VERIFIED");
    expect(canTransitionEmailStatus("SYNTAX_VALID", "VERIFIED")).toBe(true);
    expect(canTransitionEmailStatus("NOT_FOUND", "VERIFIED")).toBe(false);
    expect(() => transitionEmailStatus("DISCOVERED", "VERIFIED")).toThrow(/Cannot change/);
  });
});

describe("website selection", () => {
  it("ignores social profiles and does not treat a link hub as the official site", () => {
    const links = extractUrls("https://instagram.com/creator https://linktr.ee/creator https://tools.example.com");
    const chosen = chooseOfficialWebsite(links);
    expect(classifyUrl("https://instagram.com/creator")).toBe("social");
    expect(chosen.website).toBe("https://tools.example.com");
    expect(chosen.hubs).toEqual(["https://linktr.ee/creator"]);
  });

  it("reports the website as unavailable when nothing qualifies", () => {
    const service = new EmailDiscoveryService({
      maxPages: 2,
      fetchPage: async () => ({ ok: false, url: "", error: "unused" }),
      fetchText: async () => ({ ok: false, url: "", error: "unused" }),
    });
    expect(service.websiteFromMetadata("Follow me on https://youtube.com/@creator").websiteStatus).toBe("UNAVAILABLE");
  });
});

describe("optional providers", () => {
  it("stays unconfigured without credentials and does not claim verification", async () => {
    const provider = verificationProviderFromEnv({ provider: "zerobounce", apiKey: "" });
    expect(provider.configured).toBe(false);
    await expect(provider.verify("a@b.com")).rejects.toThrow(/not configured/);
    expect(mapZeroBounceStatus("catch-all")).toBe("unknown");
    expect(mapNeverBounceResult("invalid")).toBe("invalid");
  });

  it("reads only emails returned by a licensed domain search", () => {
    const emails = hunterEmailsFromResponse({ data: { emails: [{ value: "press@brand.com", sources: [{ uri: "https://brand.com/contact" }] }] } });
    expect(emails).toEqual([{ email: "press@brand.com", sourceUrl: "https://brand.com/contact" }]);
  });
});
