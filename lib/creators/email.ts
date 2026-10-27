import type { ConfidenceStatus, EmailContact } from "@prisma/client";

const STATUS_RANK: Record<string, number> = {
  VERIFIED: 0,
  SYNTAX_VALID: 1,
  DISCOVERED: 2,
  UNKNOWN: 3,
  NEEDS_REVIEW: 4,
  INVALID: 5,
  NOT_FOUND: 6,
};

const CONFIDENCE_RANK: Record<ConfidenceStatus, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  AMBIGUOUS: 0,
};

export function pickPrimaryEmail<T extends Pick<EmailContact, "verificationStatus" | "confidenceStatus"> & { isGenericInbox?: boolean }>(emails: T[]) {
  if (emails.length === 0) return null;
  return [...emails].sort((left, right) => {
    const generic = Number(Boolean(left.isGenericInbox)) - Number(Boolean(right.isGenericInbox));
    if (generic !== 0) return generic;
    const status = (STATUS_RANK[left.verificationStatus] ?? 9) - (STATUS_RANK[right.verificationStatus] ?? 9);
    if (status !== 0) return status;
    return CONFIDENCE_RANK[right.confidenceStatus] - CONFIDENCE_RANK[left.confidenceStatus];
  })[0] ?? null;
}

export function channelOriginLabel(source: string) {
  if (source === "YOUTUBE_SEARCH") return "YouTube search";
  if (source === "CSV_IMPORT") return "CSV import";
  if (source === "MANUAL") return "Added manually";
  return source.replaceAll("_", " ");
}

export function emailOriginLabel(source: string) {
  if (source === "CHANNEL_DESCRIPTION") return "Channel description";
  if (source === "MAILTO") return "Mailto link";
  if (source === "PUBLIC_PAGE") return "Public page";
  if (source === "CSV_IMPORT") return "CSV import";
  if (source === "LICENSED_PROVIDER") return "Contact provider";
  if (source === "MANUAL") return "Added manually";
  return source.replaceAll("_", " ");
}

export function provenanceNote(sourceType: string) {
  switch (sourceType) {
    case "CHANNEL_DESCRIPTION":
      return "Published in the channel description returned as public metadata. This is not YouTube's private contact-email field.";
    case "MAILTO":
      return "Extracted from a public mailto link.";
    case "PUBLIC_PAGE":
      return "Extracted from a public page on a website or link hub published by the creator.";
    case "LICENSED_PROVIDER":
      return "Returned by the configured licensed contact provider. Not marked verified.";
    case "CSV_IMPORT":
      return "Imported from a CSV file. Syntax was checked. The address was not verified automatically.";
    default:
      return "Stored from a user-entered source. Not verified automatically.";
  }
}
