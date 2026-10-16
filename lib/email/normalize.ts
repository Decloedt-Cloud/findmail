import { z } from "zod";

const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "email.com",
  "domain.com",
  "yourdomain.com",
  "yoursite.com",
  "website.com",
  "sample.com",
  "invalid.com",
  "fake.com",
  "placeholder.com",
  "email.example",
]);

const PLACEHOLDER_LOCAL = new Set([
  "example",
  "email",
  "yourname",
  "youremail",
  "your.email",
  "username",
  "name",
  "user",
  "test",
  "someone",
  "you",
  "your",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
]);

const GENERIC_LOCAL = new Set([
  "info",
  "contact",
  "hello",
  "hi",
  "support",
  "help",
  "partnerships",
  "partnership",
  "business",
  "press",
  "media",
  "sales",
  "team",
  "admin",
  "office",
  "collab",
  "collaborations",
  "sponsorship",
  "sponsorships",
  "booking",
  "inquiries",
  "inquiry",
  "enquiries",
  "enquiry",
]);

const FILE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "css", "js", "ico"]);

const SYNTAX =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,24})+$/;

export type EmailAssessment = {
  normalized: string;
  validSyntax: boolean;
  placeholder: boolean;
  genericInbox: boolean;
  reason?: string;
};

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().replace(/^mailto:/i, "").split("?")[0]?.trim() ?? "";
}

export function assessEmail(value: string): EmailAssessment {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 254 || !SYNTAX.test(normalized)) {
    return { normalized, validSyntax: false, placeholder: false, genericInbox: false, reason: "Invalid email syntax" };
  }
  const [local, domain] = normalized.split("@") as [string, string];
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (FILE_TLDS.has(tld) || local.includes("..") || domain.includes("..")) {
    return { normalized, validSyntax: false, placeholder: false, genericInbox: false, reason: "Malformed email" };
  }
  const placeholder = PLACEHOLDER_DOMAINS.has(domain) || (PLACEHOLDER_LOCAL.has(local) && (domain.endsWith(".example") || PLACEHOLDER_DOMAINS.has(domain) || local === "youremail" || local === "yourname" || local === "example"));
  const systemLocal = PLACEHOLDER_LOCAL.has(local) && ["noreply", "no-reply", "donotreply", "do-not-reply"].includes(local);
  if (placeholder || systemLocal || PLACEHOLDER_LOCAL.has(local) && PLACEHOLDER_DOMAINS.has(domain)) {
    return { normalized, validSyntax: true, placeholder: true, genericInbox: false, reason: "Placeholder or example address" };
  }
  if (["noreply", "no-reply", "donotreply", "do-not-reply"].includes(local)) {
    return { normalized, validSyntax: true, placeholder: true, genericInbox: false, reason: "Non-contact system address" };
  }
  return {
    normalized,
    validSyntax: true,
    placeholder: false,
    genericInbox: GENERIC_LOCAL.has(local),
  };
}

export function isSameSite(email: string, websiteUrl: string | null | undefined): boolean {
  if (!websiteUrl) return false;
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "").toLowerCase();
    const domain = email.split("@")[1]?.replace(/^www\./, "").toLowerCase();
    if (!domain) return false;
    return domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

const emailSchema = z.string().email();

export function passesZodEmail(value: string) {
  return emailSchema.safeParse(value).success;
}
