import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { creatorMatchesTopic } from "@/lib/creators/query";
import { prisma } from "@/lib/db";
import { matchesSearchCountry } from "@/lib/youtube/client";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const [total, jobs, used] = await prisma.$transaction([
      prisma.searchJob.count(),
      prisma.searchJob.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.apiUsage.aggregate({
        where: { provider: "youtube", createdAt: { gte: start } },
        _sum: { units: true },
      }),
    ]);
    const processingIds = jobs.map((job) => job.processingJobId).filter((id): id is string => Boolean(id));
    const saved = processingIds.length === 0
      ? []
      : await prisma.jobItem.findMany({
          where: { jobId: { in: processingIds }, creatorId: { not: null } },
          select: {
            jobId: true,
            creatorId: true,
            creator: {
              select: {
                channelName: true,
                channelHandle: true,
                description: true,
                country: true,
                discoveryRegion: true,
                emails: { select: { id: true }, take: 1 },
              },
            },
          },
        });
    const keywordsByJob = new Map(jobs.map((job) => [job.processingJobId, job.keywords]));
    const countriesByJob = new Map(jobs.map((job) => [job.processingJobId, job.countries]));
    const creatorCount = new Map<string, Set<string>>();
    const emailCount = new Map<string, Set<string>>();
    for (const item of saved) {
      if (!item.creatorId || !item.creator) continue;
      const keywords = keywordsByJob.get(item.jobId) ?? [];
      const countries = countriesByJob.get(item.jobId) ?? [];
      if (!creatorMatchesTopic(item.creator, keywords) || !matchesSearchCountry(item.creator, countries)) continue;
      const creators = creatorCount.get(item.jobId) ?? new Set<string>();
      creators.add(item.creatorId);
      creatorCount.set(item.jobId, creators);
      if (item.creator.emails.length > 0) {
        const emailed = emailCount.get(item.jobId) ?? new Set<string>();
        emailed.add(item.creatorId);
        emailCount.set(item.jobId, emailed);
      }
    }
    return NextResponse.json({
      jobs: jobs.map((job) => ({
        ...job,
        creatorCount: job.processingJobId ? creatorCount.get(job.processingJobId)?.size ?? 0 : 0,
        emailCount: job.processingJobId ? emailCount.get(job.processingJobId)?.size ?? 0 : 0,
      })),
      total,
      page,
      pageSize,
      quota: { used: used._sum.units ?? 0, daily: Number(process.env.YOUTUBE_DAILY_QUOTA || 10000) },
    });
  } catch (error) {
    return jsonError(error);
  }
}
