import { ICP_AUDIENCE_KEY } from "@/lib/icp/audience";
import { normalizeSearchLanguage, normalizeSearchLanguages, snapshotSearchLanguages } from "@/lib/icp/search-language";
import { ApiError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { icpHost, icpIdentityKey } from "@/lib/icp/identity";
import { enqueueProcessingJob } from "@/lib/jobs/queue";
import type { wayoAdsIcpSchema } from "@/lib/schemas";
import type { z } from "zod";

type IcpInput = z.infer<typeof wayoAdsIcpSchema>;

function snapshotRequestId(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const id = (snapshot as { requestId?: unknown }).requestId;
  return typeof id === "string" ? id : "";
}

function buildSnapshot(input: IcpInput, maxChannels: number, rounds: number) {
  return {
    kind: input.stage === "complex" ? ("complex" as const) : ("simplified" as const),
    language: "en" as const,
    audience: ICP_AUDIENCE_KEY,
    icps: input.icp.icps,
    offers: input.icp.offers,
    requestId: input.requestId ?? null,
    matchingText: input.matchingText ?? null,
  request: input.request ?? null,
  countries: (input.countries ?? []).map((code) => code.toUpperCase()),
  searchLanguage: normalizeSearchLanguages(input.languages).at(0) ?? normalizeSearchLanguage(input.language),
  searchLanguages: normalizeSearchLanguages([...(input.languages ?? []), input.language]),
  maxChannels,
  /** How many `maxChannels`-sized batches this request has asked for. */
  rounds,
    persistedAt: new Date().toISOString(),
  };
}

async function queueBrand(
  input: IcpInput,
  existingId: string | null,
  snapshot: ReturnType<typeof buildSnapshot>,
  /**
   * A search again adds a batch behind the one already on the request. Its
   * channels stay: they are the ones the advertiser has already been shown.
   */
  appendMatches = false,
) {
  const job = await prisma.processingJob.create({
    data: {
      type: "MATCH_ICP_CHANNELS",
      name: (input.stage === "complex" ? `ICP match ${input.brandName}` : `ICP ${input.brandName}`).slice(0, 120),
      payload: { onboardingId: input.onboardingId, requestId: input.requestId ?? null },
      totalRecords: snapshot.maxChannels,
    },
  });
  /* An appended round keeps the batch already on the request, so its count stays
     true even if this run fails before it can report a new total. */
  const keptCount =
    existingId && appendMatches ? await prisma.icpChannelMatch.count({ where: { brandIcpId: existingId } }) : 0;
  const data = {
    websiteUrl: input.websiteUrl,
    brandName: input.brandName,
    snapshot,
    searchQueries: [] as string[],
    analysisNote: null,
    status: "QUEUED" as const,
    matchedChannelCount: keptCount,
    errorSummary: null,
    processingJobId: job.id,
  };
  const brand = existingId
    ? await prisma.brandIcp.update({ where: { id: existingId }, data })
    : await prisma.brandIcp.create({
        data: { wayoOnboardingId: input.onboardingId, ...data },
      });
  if (existingId && !appendMatches) {
    await prisma.icpChannelMatch.deleteMany({ where: { brandIcpId: existingId } });
  }
  await prisma.processingJob.update({
    where: { id: job.id },
    data: { payload: { brandIcpId: brand.id, onboardingId: input.onboardingId, requestId: input.requestId ?? null } },
  });
  try {
    await enqueueProcessingJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 800) : "Matching could not be queued.";
    await prisma.brandIcp.update({
      where: { id: brand.id },
      data: { status: "FAILED", errorSummary: message },
    });
    throw new ApiError(503, "We couldn't queue the channel search. Redis needs to be running.");
  }
  return { id: brand.id, status: "QUEUED" as const, queued: true as const };
}

function snapshotCountries(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const raw = (snapshot as { countries?: unknown }).countries;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((code) => (typeof code === "string" && /^[A-Za-z]{2}$/.test(code) ? [code.toUpperCase()] : []));
}

function sameCodeList(stored: string[], requested: string[]) {
  return [...stored].sort().join(",") === [...requested].sort().join(",");
}

function snapshotRounds(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return 1;
  const raw = Number((snapshot as { rounds?: unknown }).rounds);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** A search that started moments ago is still the current one. An older queue is stuck. */
const ACTIVE_SEARCH_MS = 10 * 60 * 1000;

function searchStillRunning(row: { status: string; updatedAt: Date }) {
  if (row.status !== "QUEUED" && row.status !== "RUNNING") return false;
  return Date.now() - row.updatedAt.getTime() < ACTIVE_SEARCH_MS;
}

function searchAlreadyFilled(row: { status: string; matchedChannelCount: number }) {
  return (
    (row.status === "COMPLETED" || row.status === "PARTIALLY_COMPLETED") &&
    row.matchedChannelCount > 0
  );
}

async function findBrandCopies(brandName: string, websiteUrl: string) {
  const host = icpHost(websiteUrl);
  const key = icpIdentityKey(brandName, websiteUrl);
  const rows = await prisma.brandIcp.findMany({
    where: {
      brandName: { equals: brandName, mode: "insensitive" },
      ...(host ? { websiteUrl: { contains: host, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.filter((row) => icpIdentityKey(row.brandName, row.websiteUrl) === key);
}

export async function acceptWayoIcp(input: IcpInput) {
  const maxChannels = input.maxChannels ?? (input.stage === "complex" ? 20 : 50);
  const copies = await findBrandCopies(input.brandName, input.websiteUrl);

  if (input.stage === "complex" && input.requestId) {
    const same = copies.find((row) => snapshotRequestId(row.snapshot) === input.requestId) ?? null;
    if (input.searchAgain) {
      /* Claim the row before starting. Two clicks that arrive together cannot
         both pass a status read and both open a YouTube search. */
      if (same) {
        const claimed = await prisma.brandIcp.updateMany({
          where: { id: same.id, status: { notIn: ["QUEUED", "RUNNING"] } },
          data: { status: "QUEUED" },
        });
        if (claimed.count === 0) {
          const current = await prisma.brandIcp.findUnique({
            where: { id: same.id },
            select: { status: true },
          });
          return { id: same.id, status: current?.status ?? "RUNNING", queued: false as const };
        }
      }
      const rounds = same ? snapshotRounds(same.snapshot) + 1 : 1;
      return queueBrand(input, same?.id ?? null, buildSnapshot(input, maxChannels, rounds), Boolean(same));
    }
    const requestedLanguages = normalizeSearchLanguages([...(input.languages ?? []), input.language]);
    const requestedCountries = [...new Set((input.countries ?? []).map((code) => code.toUpperCase()))];
    /* The same countries and languages keep a search that is still running, or one
       that already found channels. A failed, empty, or stuck search starts again. */
    if (
      same &&
      sameCodeList(snapshotCountries(same.snapshot), requestedCountries) &&
      sameCodeList(snapshotSearchLanguages(same.snapshot), requestedLanguages) &&
      (searchStillRunning(same) || searchAlreadyFilled(same))
    ) {
      return { id: same.id, status: same.status, queued: false as const };
    }
    return queueBrand(input, same?.id ?? null, buildSnapshot(input, maxChannels, 1));
  }

  const simplified = copies.filter((row) => snapshotRequestId(row.snapshot) === "");
  const kept = simplified.find((row) => row.status === "COMPLETED" && row.matchedChannelCount > 0)
    ?? simplified.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  if (kept) {
    return { id: kept.id, status: kept.status, queued: false as const };
  }

  return queueBrand(input, simplified[0]?.id ?? null, buildSnapshot(input, maxChannels, 1));
}
