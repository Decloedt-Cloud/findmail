import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs/actions";
import { discoverySchema } from "@/lib/schemas";
import { estimateSearchQuota } from "@/lib/youtube/client";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`discovery:${user.id}`, 20, 60 * 60 * 1000);
    if (!process.env.YOUTUBE_API_KEY?.trim()) {
      throw new ApiError(503, "YOUTUBE_API_KEY is not configured. Add it to the environment and restart the app. No search was started.");
    }
    const input = discoverySchema.parse(await readJson(request));
    const estimate = estimateSearchQuota({
      keywordCount: input.keywords.length,
      countryCount: input.countries.length,
      maxResults: input.maxResults,
      includeRecentVideos: Boolean(input.recencyDays),
      keywords: input.keywords,
      countries: input.countries,
    });
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const used = await prisma.apiUsage.aggregate({
      where: { provider: "youtube", createdAt: { gte: start } },
      _sum: { units: true },
    });
    const daily = Number(process.env.YOUTUBE_DAILY_QUOTA || 10000);
    const consumed = used._sum.units ?? 0;
    if (consumed + estimate > daily) {
      throw new ApiError(429, `This search is estimated to use ${estimate} quota units and ${consumed} have already been recorded today. The configured daily budget is ${daily}.`);
    }
    const name = input.name || `${input.niche || input.keywords[0]} · ${input.countries.join(", ")}`;
    const job = await prisma.processingJob.create({
      data: {
        type: "DISCOVER_CREATORS",
        name,
        userId: user.id,
        payload: input,
        totalRecords: input.maxResults,
      },
    });
    const search = await prisma.searchJob.create({
      data: {
        name,
        keywords: input.keywords,
        niche: input.niche,
        countries: input.countries.map((country) => country.toUpperCase()),
        language: input.language,
        minSubscribers: input.minSubscribers,
        maxSubscribers: input.maxSubscribers,
        maxResults: input.maxResults,
        requirePublicEmail: input.requirePublicEmail,
        recencyDays: input.recencyDays,
        userId: user.id,
        processingJobId: job.id,
      },
    });
    await queueJob(job.id);
    await audit(user.id, "discovery.start", "searchJob", search.id, { estimate });
    return NextResponse.json({ searchJob: search, processingJobId: job.id, estimatedQuota: estimate }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
