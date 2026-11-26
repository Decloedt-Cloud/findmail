import { readChannelIcp } from "@/lib/icp/channel-icp";
import { logger } from "@/lib/logger";
import {
  MIN_DOMAIN_CONFIDENCE,
  readRecentPublicVideos,
  type ChannelDomainDecision,
  type DomainMatchAudit,
  type DomainProfile,
} from "@/lib/icp/domain-types";
import {
  DOMAIN_TAXONOMY_VERSION,
  domainRelationship,
  domainTaxonomyPrompt,
  isDomainPath,
} from "@/lib/icp/domain-taxonomy";

export type IcpSelectCandidate = {
  id: string;
  channelName: string;
  description: string | null;
  keywords: string[];
  channelIcp: unknown;
  recentPublicVideos: unknown;
};

type DomainDecision = {
  id?: unknown;
  path?: unknown;
  label?: unknown;
  evidence?: unknown;
  audienceFit?: unknown;
  confidence?: unknown;
};

export type ParsedDomainSelection = {
  decisions: ChannelDomainDecision[];
};

export function parseDomainSelection(
  raw: string,
  allowed: Set<string>,
  limit: number,
): ParsedDomainSelection {
  const empty = { decisions: [] };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const root = parsed as { decisions?: unknown };
  if (!Array.isArray(root.decisions)) return empty;
  const decisions: ChannelDomainDecision[] = [];
  for (const rawDecision of root.decisions) {
    if (!rawDecision || typeof rawDecision !== "object") continue;
    const decision = rawDecision as DomainDecision;
    const id = typeof decision.id === "string" ? decision.id : "";
    const label = typeof decision.label === "string" ? decision.label.trim() : "";
    const evidence = Array.isArray(decision.evidence)
      ? decision.evidence
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .map((value) => value.replace(/\s+/g, " ").trim().slice(0, 300))
        .slice(0, 5)
      : [];
    const confidence = typeof decision.confidence === "number" ? decision.confidence : NaN;
    if (!id || !allowed.has(id) || decisions.some((item) => item.creatorId === id)) continue;
    if (!isDomainPath(decision.path) || !label || evidence.length === 0) continue;
    if (decision.audienceFit !== "strong" && decision.audienceFit !== "weak" && decision.audienceFit !== "unclear") continue;
    if (!Number.isFinite(confidence) || confidence < MIN_DOMAIN_CONFIDENCE || confidence > 1) continue;
    decisions.push({
      creatorId: id,
      path: decision.path,
      label: label.slice(0, 120),
      evidence,
      audienceFit: decision.audienceFit,
      confidence,
    });
    if (decisions.length >= limit) break;
  }
  return { decisions };
}

export type DomainSelectionResult = {
  creatorIds: string[];
  audits: DomainMatchAudit[];
};

type SelectInput = {
  brandName: string;
  snapshot: unknown;
  searchQueries: string[];
  advertiserDomain: DomainProfile;
  candidates: IcpSelectCandidate[];
  limit: number;
};

function candidatePayload(candidate: IcpSelectCandidate) {
  return {
    id: candidate.id,
    name: candidate.channelName,
    description: candidate.description?.slice(0, 500) || null,
    keywords: candidate.keywords.slice(0, 12),
    audience: readChannelIcp(candidate.channelIcp),
    recentVideos: readRecentPublicVideos(candidate.recentPublicVideos),
  };
}

async function classify(
  input: SelectInput,
  candidates: IcpSelectCandidate[],
  role: "classifier" | "verifier",
) {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return { model: "", decisions: [] as ChannelDomainDecision[] };
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const response = await fetch(process.env.DEEPSEEK_API_URL?.trim() || "https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            role === "classifier"
              ? "Classify each YouTube channel's primary content domain."
              : "Independently verify each YouTube channel's primary content domain. You have not seen another classifier's decision.",
            `The advertiser domain is fixed as ${input.advertiserDomain.path} (${input.advertiserDomain.label}).`,
            "Use recent public video titles and descriptions as the strongest evidence.",
            "The About description, keywords, and audience profile are supporting evidence only.",
            "Choose exactly one path from the canonical taxonomy.",
            "Do not accept audience overlap, demographics, lifestyle affinity, or one shared keyword as domain evidence.",
            "audienceFit must be one of: strong, weak, unclear.",
            "Confidence is not a guess: use 0.85 or higher only when the supplied evidence is specific and unambiguous.",
            "When recent video evidence is insufficient or mixed, use unclear and low confidence.",
            "Return a decision for every candidate.",
            "Return concise evidence, not hidden chain-of-thought.",
            'Return JSON only: {"decisions":[{"id":"","path":"","label":"","evidence":[""],"audienceFit":"strong|weak|unclear","confidence":0.0}]}.',
            `Taxonomy version ${DOMAIN_TAXONOMY_VERSION}:`,
            domainTaxonomyPrompt(),
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            advertiserDomain: input.advertiserDomain,
            channels: candidates.map(candidatePayload),
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    logger.warn("icp domain pass skipped", { role, status: response.status });
    return { model, decisions: [] as ChannelDomainDecision[] };
  }
  const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  const allowed = new Set(candidates.map((creator) => creator.id));
  const parsed = parseDomainSelection(body.choices?.[0]?.message?.content ?? "", allowed, candidates.length);
  return { model, decisions: parsed.decisions };
}

function isStrongFit(advertiserPath: string, decision: ChannelDomainDecision) {
  const relationship = domainRelationship(advertiserPath, decision.path);
  return (
    (relationship === "same_domain" || relationship === "direct_subdomain")
    && decision.audienceFit === "strong"
    && decision.confidence >= MIN_DOMAIN_CONFIDENCE
  );
}

/** Both passes must name the same strong path. Disagreement rejects the channel. */
export function agreeDomainAudits(input: {
  advertiserPath: string;
  classifier: ChannelDomainDecision[];
  verifier: ChannelDomainDecision[];
  model: string;
  limit: number;
}): DomainMatchAudit[] {
  const verified = new Map(input.verifier.map((decision) => [decision.creatorId, decision]));
  const audits: DomainMatchAudit[] = [];
  for (const classifier of input.classifier) {
    if (!isStrongFit(input.advertiserPath, classifier)) continue;
    const verifier = verified.get(classifier.creatorId);
    if (!verifier || !isStrongFit(input.advertiserPath, verifier) || classifier.path !== verifier.path) continue;
    const relationship = domainRelationship(input.advertiserPath, classifier.path);
    if (relationship !== "same_domain" && relationship !== "direct_subdomain") continue;
    audits.push({
      taxonomyVersion: DOMAIN_TAXONOMY_VERSION,
      advertiserPath: input.advertiserPath,
      classifier,
      verifier,
      relationship,
      confidence: Math.min(classifier.confidence, verifier.confidence),
      evidence: [...new Set([...classifier.evidence, ...verifier.evidence])].slice(0, 5),
      model: input.model,
      verifiedAt: new Date().toISOString(),
    });
    if (audits.length >= input.limit) break;
  }
  return audits;
}

/** Classifier and verifier must independently agree on a strong same-domain fit. */
export async function selectCreatorsForIcp(input: SelectInput): Promise<DomainSelectionResult> {
  if (input.limit <= 0 || input.candidates.length === 0) return { creatorIds: [], audits: [] };
  const candidates = input.candidates.filter((candidate) =>
    readRecentPublicVideos(candidate.recentPublicVideos).length > 0
  );
  if (candidates.length === 0) return { creatorIds: [], audits: [] };
  const first = await classify(input, candidates, "classifier");
  const preliminary = first.decisions
    .filter((decision) => isStrongFit(input.advertiserDomain.path, decision))
    .slice(0, input.limit);
  if (preliminary.length === 0) return { creatorIds: [], audits: [] };
  const preliminaryIds = new Set(preliminary.map((decision) => decision.creatorId));
  const verifyCandidates = candidates.filter((candidate) => preliminaryIds.has(candidate.id));
  const second = await classify(input, verifyCandidates, "verifier");
  const audits = agreeDomainAudits({
    advertiserPath: input.advertiserDomain.path,
    classifier: preliminary,
    verifier: second.decisions,
    model: first.model || second.model,
    limit: input.limit,
  });
  logger.info("icp domain selection", {
    advertiserDomain: input.advertiserDomain.path,
    candidates: candidates.length,
    classified: preliminary.length,
    verified: audits.length,
  });
  return { creatorIds: audits.map((audit) => audit.classifier.creatorId), audits };
}
