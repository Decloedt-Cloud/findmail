import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { domainInputHash, domainProfileFromReply, MIN_DOMAIN_CONFIDENCE, readDomainProfile, type DomainProfile } from "@/lib/icp/domain-types";
import { DOMAIN_TAXONOMY_VERSION, domainTaxonomyPrompt } from "@/lib/icp/domain-taxonomy";

type BrandDomainInput = {
  id: string;
  brandName: string;
  websiteUrl: string;
  snapshot: unknown;
  domainProfile: unknown;
  domainInputHash: string | null;
};

const VIDEO_HOST = /(^|\.)((youtube|youtu\.be|instagram|tiktok|facebook|twitter|x)\.com|youtu\.be)$/i;

function textOf(value: unknown, max = 800): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A video link is the creative, not the company site. */
function commercialSite(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return VIDEO_HOST.test(host) ? null : raw.trim();
  } catch {
    return null;
  }
}

function businessBrief(brand: BrandDomainInput) {
  const snapshot = brand.snapshot && typeof brand.snapshot === "object"
    ? brand.snapshot as Record<string, unknown>
    : {};
  const request = snapshot.request && typeof snapshot.request === "object"
    ? snapshot.request as Record<string, unknown>
    : {};
  const rows = (value: unknown) => Array.isArray(value) ? value : [];
  return {
    brandName: brand.brandName,
    websiteUrl: commercialSite(brand.websiteUrl),
    adFormat: textOf(request.kind, 40) || null,
    requestTitle: textOf(request.title, 200) || null,
    description: textOf(request.description, 2000) || textOf(snapshot.matchingText, 2000) || null,
    offers: rows(snapshot.offers).slice(0, 4).map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return { name: textOf(row.name, 120), description: textOf(row.description) };
    }),
    icps: rows(snapshot.icps).slice(0, 3).map((item) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return { name: textOf(row.name, 120), description: textOf(row.description) };
    }),
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
            "Classify the advertiser's single primary product domain.",
            "adFormat is how the ad is published. It is not what the company sells.",
            "A missing websiteUrl means the link was a video. Ignore it.",
            "Copy one path exactly from the taxonomy. A more specific product still uses that branch, such as fashion/footwear/general for sports shoes.",
            "When the description names the product, set confidence at or above 0.85.",
            "Set confidence below 0.85 only when the description never says what is sold.",
            "Cite concise evidence from the description.",
            'Return JSON only: {"path":"","label":"","evidence":[""],"confidence":0}.',
            `Taxonomy version ${DOMAIN_TAXONOMY_VERSION}:`,
            domainTaxonomyPrompt(),
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(businessBrief(brand)),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("We couldn't classify the advertiser domain.");
  const body = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
  const read = domainProfileFromReply(body.choices?.[0]?.message?.content ?? "", model);
  if (!read.profile) {
    throw new Error(`The advertiser domain was not clear enough to match channels safely. ${read.reason}`);
  }
  const profile = read.profile;
  await prisma.brandIcp.update({
    where: { id: brand.id },
    data: { domainProfile: profile as unknown as Prisma.InputJsonValue, domainInputHash: hash },
  });
  return profile;
}
