import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { domainInputHash, MIN_DOMAIN_CONFIDENCE, readDomainProfile, type DomainProfile } from "@/lib/icp/domain-types";
import { DOMAIN_TAXONOMY_VERSION, domainTaxonomyPrompt, isDomainPath } from "@/lib/icp/domain-taxonomy";

type BrandDomainInput = {
  id: string;
  brandName: string;
  websiteUrl: string;
  snapshot: unknown;
  domainProfile: unknown;
  domainInputHash: string | null;
};

function parseProfile(raw: string, model: string): DomainProfile | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as { path?: unknown; label?: unknown; evidence?: unknown; confidence?: unknown };
  const evidence = Array.isArray(row.evidence)
    ? row.evidence.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 5)
    : [];
  if (
    !isDomainPath(row.path)
    || typeof row.label !== "string"
    || !row.label.trim()
    || typeof row.confidence !== "number"
    || row.confidence < MIN_DOMAIN_CONFIDENCE
    || row.confidence > 1
    || evidence.length === 0
  ) return null;
  return {
    taxonomyVersion: DOMAIN_TAXONOMY_VERSION,
    path: row.path,
    label: row.label.trim().slice(0, 120),
    evidence: evidence.map((item) => item.replace(/\s+/g, " ").trim().slice(0, 300)),
    confidence: row.confidence,
    model,
    classifiedAt: new Date().toISOString(),
  };
}

export async function ensureAdvertiserDomain(brand: BrandDomainInput): Promise<DomainProfile> {
  const hash = domainInputHash(brand);
  if (brand.domainInputHash === hash) {
    const stored = readDomainProfile(brand.domainProfile);
    if (stored) return stored;
  }

  const reusable = await prisma.brandIcp.findFirst({
    where: {
      id: { not: brand.id },
      websiteUrl: brand.websiteUrl,
      domainInputHash: hash,
      domainProfile: { not: Prisma.DbNull },
    },
    orderBy: { updatedAt: "desc" },
    select: { domainProfile: true },
  });
  const reused = readDomainProfile(reusable?.domainProfile);
  if (reused) {
    await prisma.brandIcp.update({
      where: { id: brand.id },
      data: { domainProfile: reused as unknown as Prisma.InputJsonValue, domainInputHash: hash },
    });
    return reused;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured.");
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const response = await fetch(process.env.DEEPSEEK_API_URL?.trim() || "https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Classify the advertiser's single primary business domain.",
            "Use only the supplied offer, request, and ICP. Do not infer a broad audience hobby.",
            "Choose exactly one canonical path from the taxonomy below.",
            "Cite concise concrete evidence from the supplied business data.",
            `Use confidence below ${MIN_DOMAIN_CONFIDENCE} when the primary domain is ambiguous.`,
            'Return JSON only: {"path":"","label":"","evidence":[""],"confidence":0}.',
            `Taxonomy version ${DOMAIN_TAXONOMY_VERSION}:`,
            domainTaxonomyPrompt(),
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            brandName: brand.brandName,
            websiteUrl: brand.websiteUrl,
            business: brand.snapshot,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("We couldn't classify the advertiser domain.");
  const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  const profile = parseProfile(body.choices?.[0]?.message?.content ?? "", model);
  if (!profile) throw new Error("The advertiser domain was not clear enough to match channels safely.");
  await prisma.brandIcp.update({
    where: { id: brand.id },
    data: { domainProfile: profile as unknown as Prisma.InputJsonValue, domainInputHash: hash },
  });
  return profile;
}
