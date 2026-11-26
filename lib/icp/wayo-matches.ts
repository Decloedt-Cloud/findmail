import { Prisma } from "@prisma/client";
import { USABLE_CONTACT, hasPublicContact } from "@/lib/creators/contact";
import { usablePublicEmails } from "@/lib/creators/email";
import { prisma } from "@/lib/db";
import { ICP_MAX_SUBSCRIBERS, ICP_MIN_SUBSCRIBERS } from "@/lib/icp/audience";
import { icpHost } from "@/lib/icp/identity";
import { snapshotSearchLanguages } from "@/lib/icp/search-language";
import { isSpecificLanguageChoice } from "@/lib/youtube/spoken-language";
import { readDomainMatchAudit } from "@/lib/icp/domain-types";

function snapshotSearchPhase(snapshot: unknown): "catalog" | "writing" | "youtube" | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const phase = (snapshot as { searchPhase?: unknown }).searchPhase;
  return phase === "catalog" || phase === "writing" || phase === "youtube" ? phase : null;
}

function snapshotRequestId(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const id = (snapshot as { requestId?: unknown }).requestId;
  return typeof id === "string" ? id : "";
}

function channelIcpName(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 120) : null;
}

async function creatorsProposedOnOtherRequests(
  rows: { id: string; snapshot: unknown }[],
  brandId: string,
  requestId: string,
) {
  if (!requestId) return new Set<string>();
  const otherIds = rows
    .filter((row) => row.id !== brandId && snapshotRequestId(row.snapshot) && snapshotRequestId(row.snapshot) !== requestId)
    .map((row) => row.id);
  if (otherIds.length === 0) return new Set<string>();
  const links = await prisma.icpChannelMatch.findMany({
    where: { brandIcpId: { in: otherIds } },
    select: { creatorId: true },
  });
  return new Set(links.map((link) => link.creatorId));
}

function maxChannels(snapshot: unknown) {
  const raw = snapshot && typeof snapshot === "object" ? Number((snapshot as { maxChannels?: unknown }).maxChannels) : NaN;
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return Math.floor(raw);
  return 10;
}

/** How many batches this request has asked for. One before any search again. */
function snapshotRounds(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return 1;
  const raw = Number((snapshot as { rounds?: unknown }).rounds);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function sameSite(websiteUrl: string, requested: string | undefined) {
  if (!requested?.trim()) return true;
  return icpHost(websiteUrl) === icpHost(requested);
}

export async function listWayoIcpMatches(input: {
  onboardingId: string;
  requestId?: string;
  countries?: string;
  website?: string;
}) {
  const rows = await prisma.brandIcp.findMany({
    where: { wayoOnboardingId: input.onboardingId },
    orderBy: { createdAt: "desc" },
  });
  const forRequest = input.requestId
    ? rows.filter((row) => snapshotRequestId(row.snapshot) === input.requestId)
    : rows;
  /* The onboarding row is reused when the advertiser enters another URL. The
     previous site's channels stay stored, and they must not fill the new search. */
  let brand = forRequest.find((row) => sameSite(row.websiteUrl, input.website)) ?? null;
  /* A finished search started before this request existed has the channels and
     no request id. Claim it for the request that is asking, so the page can
     show them instead of starting another search. */
  if (!brand && input.requestId) {
    const unscoped = rows.find(
      (row) =>
        sameSite(row.websiteUrl, input.website) &&
        !snapshotRequestId(row.snapshot) &&
        row.matchedChannelCount > 0 &&
        (row.status === "COMPLETED" || row.status === "PARTIALLY_COMPLETED"),
    );
    if (unscoped && unscoped.snapshot && typeof unscoped.snapshot === "object") {
      const snapshot = { ...(unscoped.snapshot as Record<string, unknown>), requestId: input.requestId };
      await prisma.brandIcp.update({
        where: { id: unscoped.id },
        data: { snapshot: snapshot as Prisma.InputJsonValue },
      });
      brand = { ...unscoped, snapshot };
    }
  }
  if (!brand) {
    return { id: null, status: "MISSING" as const, creators: [] };
  }
  const alreadyProposed = await creatorsProposedOnOtherRequests(rows, brand.id, input.requestId ?? "");
  /* Every batch this request asked for stays readable: the first search plus each
     search again, up to a ceiling the screen can still scroll. */
  const limit = Math.min(maxChannels(brand.snapshot) * snapshotRounds(brand.snapshot), 100);
  const countries = (input.countries || "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
  const languages = snapshotSearchLanguages(brand.snapshot);
  const languageWhere = isSpecificLanguageChoice(languages)
    ? {
        OR: languages.flatMap((code) => [
          { language: { equals: code, mode: "insensitive" as const } },
          { language: { startsWith: `${code},`, mode: "insensitive" as const } },
          { language: { endsWith: `,${code}`, mode: "insensitive" as const } },
          { language: { contains: `,${code},`, mode: "insensitive" as const } },
          { language: { startsWith: `${code}-`, mode: "insensitive" as const } },
          { language: { contains: `,${code}-`, mode: "insensitive" as const } },
        ]),
      }
    : null;
  const links = await prisma.icpChannelMatch.findMany({
    where: {
      brandIcpId: brand.id,
      creator: {
        hidden: false,
        subscriberVisibility: "PUBLIC",
        subscriberCount: { gte: ICP_MIN_SUBSCRIBERS, lte: ICP_MAX_SUBSCRIBERS },
        AND: [
          USABLE_CONTACT,
          ...(languageWhere ? [languageWhere] : []),
          ...(countries.length
            ? [{
                OR: [
                  ...countries.map((code) => ({ country: { equals: code, mode: "insensitive" as const } })),
                  ...countries.flatMap((code) => [
                    { contentCountries: { equals: code, mode: "insensitive" as const } },
                    { contentCountries: { startsWith: `${code},`, mode: "insensitive" as const } },
                    { contentCountries: { endsWith: `,${code}`, mode: "insensitive" as const } },
                    { contentCountries: { contains: `,${code},`, mode: "insensitive" as const } },
                  ]),
                ],
              }]
            : []),
        ],
      },
    },
    orderBy: { creator: { subscriberCount: "desc" } },
    take: limit,
    include: {
      creator: {
        select: {
          id: true,
          youtubeChannelId: true,
          channelName: true,
          channelHandle: true,
          channelUrl: true,
          description: true,
        country: true,
        language: true,
        keywords: true,
          subscriberCount: true,
          subscriberVisibility: true,
          videoCount: true,
          viewCount: true,
          thumbnailUrl: true,
          averageViews: true,
          lastActiveAt: true,
          officialWebsiteUrl: true,
          instagramUrl: true,
          twitterUrl: true,
          tiktokUrl: true,
          matchedVideoTitle: true,
          matchedVideoUrl: true,
          matchedVideoViews: true,
          matchedVideoPublishedAt: true,
          publishesLongForm: true,
          publishesShorts: true,
          channelIcp: true,
          emails: {
            select: {
              emailAddress: true,
              sourceType: true,
              sourceUrl: true,
              verificationStatus: true,
              isGenericInbox: true,
              confidenceStatus: true,
            },
          },
        },
      },
    },
  });
  const creators = links.flatMap((link) => {
    if (alreadyProposed.has(link.creator.id)) return [];
    const creator = link.creator;
    const domainMatch = readDomainMatchAudit(link.domainMatch);
    if (!domainMatch) return [];
    const emails = usablePublicEmails(creator.emails);
    const socials = {
      instagram: creator.instagramUrl?.trim() || null,
      twitter: creator.twitterUrl?.trim() || null,
      tiktok: creator.tiktokUrl?.trim() || null,
      youtube: creator.channelUrl,
    };
if (
  !hasPublicContact({
    emailCount: emails.length,
    instagramUrl: socials.instagram,
    twitterUrl: socials.twitter,
    tiktokUrl: socials.tiktok,
  }) &&
  !socials.youtube
) {
  return [];
}
    return [
      {
        id: creator.id,
        channelName: creator.channelName,
        channelHandle: creator.channelHandle,
        thumbnailUrl: creator.thumbnailUrl,
        subscriberCount: creator.subscriberCount ?? 0,
        averageViews: creator.averageViews ?? 0,
        country: creator.country,
        language: creator.language,
        publishesLongForm: creator.publishesLongForm,
        publishesShorts: creator.publishesShorts,
        channelIcpName: channelIcpName(creator.channelIcp),
        domainLabel: domainMatch.classifier.label,
        domainEvidence: domainMatch.evidence,
        domainConfidence: domainMatch.confidence,
        email: emails[0]?.emailAddress ?? null,
        emails: emails.map((item) => item.emailAddress),
        socials,
      },
    ];
  });
  return {
    id: brand.id,
    status: brand.status,
    errorSummary: brand.errorSummary,
    queries: brand.searchQueries.filter((query) => query.trim()).slice(0, 4),
    phase: snapshotSearchPhase(brand.snapshot),
    creators,
  };
}
