import { ICP_AUDIENCE_KEY } from "@/lib/icp/audience";
import { ApiError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { enqueueProcessingJob } from "@/lib/jobs/queue";
import type { wayoAdsIcpSchema } from "@/lib/schemas";
import type { z } from "zod";

type IcpInput = z.infer<typeof wayoAdsIcpSchema>;

function websiteKey(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return `${host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export async function acceptWayoIcp(input: IcpInput) {
  const siteKey = websiteKey(input.websiteUrl);
  let host = "";
  try {
    host = new URL(input.websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  const rows = await prisma.brandIcp.findMany({
    where: host ? { websiteUrl: { contains: host, mode: "insensitive" } } : undefined,
    orderBy: { createdAt: "desc" },
  });
  const sameSite = rows.filter((row) => websiteKey(row.websiteUrl) === siteKey);
  const kept = sameSite.find((row) => row.status === "COMPLETED" && row.matchedChannelCount > 0)
    ?? sameSite.find((row) => row.status === "QUEUED" || row.status === "RUNNING");
  if (kept) {
    return { id: kept.id, status: kept.status, queued: false as const };
  }
  const existing = sameSite[0] ?? null;

  const snapshot = {
    kind: "simplified" as const,
    language: "en" as const,
    audience: ICP_AUDIENCE_KEY,
    icps: input.icp.icps,
    offers: input.icp.offers,
    persistedAt: new Date().toISOString(),
  };
  const job = await prisma.processingJob.create({
    data: {
      type: "MATCH_ICP_CHANNELS",
      name: `ICP ${input.brandName}`.slice(0, 120),
      payload: { onboardingId: input.onboardingId },
      totalRecords: 30,
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
  const brand = existing
    ? await prisma.brandIcp.update({ where: { id: existing.id }, data })
    : await prisma.brandIcp.create({
        data: { wayoOnboardingId: input.onboardingId, ...data },
      });
  if (existing) {
    await prisma.icpChannelMatch.deleteMany({ where: { brandIcpId: existing.id } });
  }
  await prisma.processingJob.update({
    where: { id: job.id },
    data: { payload: { brandIcpId: brand.id, onboardingId: input.onboardingId } },
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
