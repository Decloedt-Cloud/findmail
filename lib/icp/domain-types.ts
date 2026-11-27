import { createHash } from "node:crypto";
import { canonicalizeDomainPath, DOMAIN_TAXONOMY_VERSION, isDomainPath } from "@/lib/icp/domain-taxonomy";

export const MIN_DOMAIN_CONFIDENCE = 0.85;

export type RecentPublicVideoEvidence = {
  id: string;
  title: string;
  description: string;
  publishedAt: string | null;
};

export type DomainProfile = {
  taxonomyVersion: number;
  path: string;
  label: string;
  evidence: string[];
  confidence: number;
  model: string;
  classifiedAt: string;
};

export type ChannelDomainDecision = {
  creatorId: string;
  path: string;
  label: string;
  evidence: string[];
  audienceFit: "strong" | "weak" | "unclear";
  confidence: number;
};

export type DomainMatchAudit = {
  taxonomyVersion: number;
  advertiserPath: string;
  classifier: ChannelDomainDecision;
  verifier: ChannelDomainDecision;
  relationship: "same_domain" | "direct_subdomain";
  confidence: number;
  evidence: string[];
  model: string;
  verifiedAt: string;
};

function strings(value: unknown, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function confidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

export function readDomainProfile(value: unknown): DomainProfile | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const score = confidence(row.confidence);
  const evidence = strings(row.evidence);
  if (
    row.taxonomyVersion !== DOMAIN_TAXONOMY_VERSION
    || !isDomainPath(row.path)
    || typeof row.label !== "string"
    || !row.label.trim()
    || score == null
    || score < MIN_DOMAIN_CONFIDENCE
    || evidence.length === 0
  ) return null;
  return {
    taxonomyVersion: DOMAIN_TAXONOMY_VERSION,
    path: row.path,
    label: row.label.trim().slice(0, 120),
    evidence,
    confidence: score,
    model: typeof row.model === "string" ? row.model.slice(0, 120) : "",
    classifiedAt: typeof row.classifiedAt === "string" ? row.classifiedAt : new Date(0).toISOString(),
  };
}

export function readRecentPublicVideos(value: unknown): RecentPublicVideoEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const title = typeof row.title === "string" ? row.title.replace(/\s+/g, " ").trim() : "";
    if (!id || !title) return [];
    return [{
      id: id.slice(0, 64),
      title: title.slice(0, 300),
      description: typeof row.description === "string"
        ? row.description.replace(/\s+/g, " ").trim().slice(0, 800)
        : "",
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    }];
  }).slice(0, 10);
}

export function readDomainMatchAudit(value: unknown): DomainMatchAudit | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const classifier = row.classifier as ChannelDomainDecision | undefined;
  const verifier = row.verifier as ChannelDomainDecision | undefined;
  if (
    row.taxonomyVersion !== DOMAIN_TAXONOMY_VERSION
    || !isDomainPath(row.advertiserPath)
    || !classifier
    || !verifier
    || !isDomainPath(classifier.path)
    || !isDomainPath(verifier.path)
    || classifier.creatorId !== verifier.creatorId
    || (row.relationship !== "same_domain" && row.relationship !== "direct_subdomain")
    || typeof row.confidence !== "number"
    || row.confidence < MIN_DOMAIN_CONFIDENCE
  ) return null;
  const evidence = strings(row.evidence);
  if (evidence.length === 0) return null;
  return {
    taxonomyVersion: DOMAIN_TAXONOMY_VERSION,
    advertiserPath: row.advertiserPath,
    classifier,
    verifier,
    relationship: row.relationship,
    confidence: row.confidence,
    evidence,
    model: typeof row.model === "string" ? row.model : "",
    verifiedAt: typeof row.verifiedAt === "string" ? row.verifiedAt : "",
  };
}

function readConfidence(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
}

function readEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item] : [];
    if (!item || typeof item !== "object") return [];
    const row = item as { text?: unknown; quote?: unknown };
    const text = typeof row.text === "string" ? row.text : typeof row.quote === "string" ? row.quote : "";
    return text.trim() ? [text] : [];
  }).slice(0, 5);
}

/** Read the classifier reply. A specific path folds into its listed branch. */
export function domainProfileFromReply(raw: string, model: string): { profile: DomainProfile | null; reason: string } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { profile: null, reason: "the reply was not JSON" };
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { profile: null, reason: "the reply was not JSON" };
  }
  if (!value || typeof value !== "object") return { profile: null, reason: "the reply was not JSON" };
  const row = value as { path?: unknown; label?: unknown; evidence?: unknown; confidence?: unknown };
  const path = canonicalizeDomainPath(row.path);
  const evidence = readEvidence(row.evidence).map((item) => item.replace(/\s+/g, " ").trim().slice(0, 300));
  const score = readConfidence(row.confidence);
  const label = typeof row.label === "string" ? row.label.trim().slice(0, 120) : "";
  if (!path) return { profile: null, reason: `path ${JSON.stringify(row.path)} is outside the taxonomy` };
  if (!label) return { profile: null, reason: "the reply had no label" };
  if (evidence.length === 0) return { profile: null, reason: "the reply cited no evidence" };
  if (score == null || score < MIN_DOMAIN_CONFIDENCE) {
    return { profile: null, reason: `confidence ${String(row.confidence)} is below ${MIN_DOMAIN_CONFIDENCE}` };
  }
  return {
    profile: {
      taxonomyVersion: DOMAIN_TAXONOMY_VERSION,
      path,
      label,
      evidence,
      confidence: score,
      model,
      classifiedAt: new Date().toISOString(),
    },
    reason: "",
  };
}

/** Hash only business meaning; search controls must not invalidate the domain. */
export function domainInputHash(input: {
  brandName: string;
  websiteUrl: string;
  snapshot: unknown;
}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object"
    ? input.snapshot as Record<string, unknown>
    : {};
  const business = {
    brandName: input.brandName.trim(),
    websiteUrl: input.websiteUrl.trim().toLowerCase(),
    matchingText: snapshot.matchingText ?? null,
    icps: snapshot.icps ?? null,
    offers: snapshot.offers ?? null,
    request: snapshot.request ?? null,
  };
  return createHash("sha256").update(JSON.stringify(business)).digest("hex");
}
