import { ICP_AUDIENCE_KEY } from "@/lib/icp/audience";
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

function buildSnapshot(input: IcpInput, maxChannels: number) {
  return {
    kind: input.stage === "complex" ? ("complex" as const) : ("simplified" as const),
    language: "en" as const,
    audience: ICP_AUDIENCE_KEY,
    icps: input.icp.icps,
    offers: input.icp.offers,
    requestId: input.requestId ?? null,
    matchingText: input.matchingText ?? null,
    request: input.request ?? null,
    maxChannels,
    persistedAt: new Date().toISOString(),
  };
}

async function queueBrand(input: IcpInput, existingId: string | null, snapshot: ReturnType<typeof buildSnapshot>) {
  const job = await prisma.processingJob.create({
    data: {
      type: "MATCH_ICP_CHANNELS",
      name: (input.stage === "complex" ? `ICP match ${input.brandName}` : `ICP ${input.brandName}`).slice(0, 120),
      payload: { onboardingId: input.onboardingId, requestId: input.requestId ?? null },
      totalRecords: snapshot.maxChannels,
    },
  });
  const data = {
    websiteUrl: input.websiteUrl,
    brandName: input.brandName,
    snapshot,
    searchQueries: [] as string[],
    analysisNote: null,
    status: "QUEUED" as const,
    matchedChannelCount: 0,
    errorSummary: null,
    processingJobId: job.id,
  };
  const brand = existingId
    ? await prisma.brandIcp.update({ where: { id: existingId }, data })
    : await prisma.brandIcp.create({
        data: { wayoOnboardingId: input.onboardingId, ...data },
      });
  if (existingId) {
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

function isHealthyIcp(row: { status: string; matchedChannelCount: number }) {
  return row.status === "QUEUED" || row.status === "RUNNING" || (row.status === "COMPLETED" && row.matchedChannelCount > 0);
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
    if (same && isHealthyIcp(same)) {
      return { id: same.id, status: same.status, queued: false as const };
    }
    return queueBrand(input, same?.id ?? null, buildSnapshot(input, maxChannels));
  }

  const simplified = copies.filter((row) => snapshotRequestId(row.snapshot) === "");
  const kept = simplified.find((row) => row.status === "COMPLETED" && row.matchedChannelCount > 0)
    ?? simplified.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  if (kept) {
    return { id: kept.id, status: kept.status, queued: false as const };
  }

  return queueBrand(input, simplified[0]?.id ?? null, buildSnapshot(input, maxChannels));
}
