export const EMAIL_VERIFICATION_STATUSES = [
  "DISCOVERED",
  "SYNTAX_VALID",
  "VERIFIED",
  "INVALID",
  "UNKNOWN",
  "NOT_FOUND",
  "NEEDS_REVIEW",
] as const;

export type EmailVerificationStatus = (typeof EMAIL_VERIFICATION_STATUSES)[number];

const TRANSITIONS: Record<EmailVerificationStatus, EmailVerificationStatus[]> = {
  DISCOVERED: ["SYNTAX_VALID", "INVALID", "NEEDS_REVIEW", "UNKNOWN"],
  SYNTAX_VALID: ["VERIFIED", "INVALID", "UNKNOWN", "NEEDS_REVIEW"],
  VERIFIED: ["VERIFIED", "INVALID", "UNKNOWN", "NEEDS_REVIEW"],
  INVALID: ["INVALID", "VERIFIED", "UNKNOWN", "NEEDS_REVIEW"],
  UNKNOWN: ["VERIFIED", "INVALID", "UNKNOWN", "NEEDS_REVIEW"],
  NOT_FOUND: ["NOT_FOUND"],
  NEEDS_REVIEW: ["SYNTAX_VALID", "VERIFIED", "INVALID", "UNKNOWN", "NEEDS_REVIEW"],
};

export function canTransitionEmailStatus(from: EmailVerificationStatus, to: EmailVerificationStatus) {
  return TRANSITIONS[from].includes(to);
}

export function transitionEmailStatus(from: EmailVerificationStatus, to: EmailVerificationStatus) {
  if (!canTransitionEmailStatus(from, to)) {
    throw new Error(`Cannot change email status from ${from} to ${to}`);
  }
  return to;
}

const EMAIL_STATUS_LABELS: Record<EmailVerificationStatus, string> = {
  DISCOVERED: "Found",
  SYNTAX_VALID: "Found",
  VERIFIED: "Verified",
  INVALID: "Invalid",
  UNKNOWN: "Unconfirmed",
  NOT_FOUND: "No email",
  NEEDS_REVIEW: "Needs review",
};

export function emailStatusLabel(status: string) {
  return EMAIL_STATUS_LABELS[status as EmailVerificationStatus] ?? status.replaceAll("_", " ");
}

export function statusAfterSyntaxCheck(valid: boolean, ambiguous: boolean): EmailVerificationStatus {
  if (!valid) throw new Error("Invalid addresses are discarded and do not receive a status");
  if (ambiguous) return "NEEDS_REVIEW";
  return "SYNTAX_VALID";
}

export function statusFromVerificationResult(result: "valid" | "invalid" | "unknown" | "review") {
  if (result === "valid") return "VERIFIED" as const;
  if (result === "invalid") return "INVALID" as const;
  if (result === "review") return "NEEDS_REVIEW" as const;
  return "UNKNOWN" as const;
}
