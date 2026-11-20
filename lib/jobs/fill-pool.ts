import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { USABLE_CONTACT } from "@/lib/creators/contact";
import { DISCOVERY_NICHES } from "@/lib/discovery-catalog";
import { enqueueProcessingJob } from "@/lib/jobs/queue";
import { MAX_CREATOR_SUBSCRIBERS, MIN_CREATOR_SUBSCRIBERS } from "@/lib/constants";
import { topicTier } from "@/lib/youtube/discovery";
import { youtubeQuotaDayStart } from "@/lib/youtube/quota-day";
import type { YouTubeFetch } from "@/lib/youtube/client";
import { qualifiesForStorage } from "@/lib/youtube/qualify";

/** One category per tick, on the same clock as the 04:15 cleanup. */
export const FILL_CRON = "*/30 1-5 * * *";
export const FILL_COUNTRY = "US";
export const FILL_RUN_UNITS = 800;
export const FILL_NIGHT_UNITS = 4000;
export const FILL_MAX_RESULTS = 10;
/** Gap between YouTube calls so a burst does not trip rateLimitExceeded. */
export const FILL_REQUEST_GAP_MS = 3000;
/** Manual searches: short gap between any calls, long gap between search.list calls. */
export const SEARCH_REQUEST_GAP_MS = 1000;
export const SEARCH_CALL_GAP_MS = 5000;
/** Nightly pool: same spacing, slower searches. */
export const FILL_SEARCH_CALL_GAP_MS = 6000;
const SEARCH_UNITS = 100;

const BUSY_JOBS = ["DISCOVER_CREATORS", "MATCH_ICP_CHANNELS", "PRUNE_INACTIVE_CHANNELS"] as const;

export type FillNiche = {
  id: string;
  label: string;
  query: string;
  usable: number;
  lastFilledAt: number | null;
};

export function inFillWindow(now = new Date()) {
  const hour = now.getHours();
  return hour >= 1 && hour <= 5;
}

/** Start of the current night window. Before 01:00 this is yesterday's 01:00. */
export function fillWindowStart(now = new Date()) {
  const start = new Date(now);
  start.setHours(1, 0, 0, 0);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start;
}

export function fillRunBudget(tonightUsed: number, dailyRemaining: number) {
  const nightRoom = Math.max(0, FILL_NIGHT_UNITS - Math.max(0, tonightUsed));
  const room = Math.min(FILL_RUN_UNITS, nightRoom, Math.max(0, dailyRemaining));
  return room >= SEARCH_UNITS ? room : 0;
}

/** Prefer the thinnest category, then the one filled longest ago. */
export function selectFillNiche(niches: FillNiche[]) {
  if (niches.length === 0) return null;
  return [...niches].sort((left, right) => {
    if (left.usable !== right.usable) return left.usable - right.usable;
    const leftAt = left.lastFilledAt ?? 0;
    const rightAt = right.lastFilledAt ?? 0;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.id.localeCompare(right.id);
  })[0];
}

export function stoppedByRateLimit(messages: Array<string | null | undefined>) {
  return messages.some((message) => /rateLimit/i.test(message ?? ""));
}

/**
 * Spaces YouTube calls. `gapMs` applies between any two calls. `searchGapMs`
 * applies between two search.list calls, which cost 100 units and hit the
 * rate limit first.
 */
export function paceYouTubeFetch(
  fetchImpl: YouTubeFetch,
  gapMs = FILL_REQUEST_GAP_MS,
  searchGapMs = gapMs,
): YouTubeFetch {
  let lastAny = 0;
  let lastSearch = 0;
  return async (url, init) => {
    const now = Date.now();
    const isSearch = new URL(url).pathname.endsWith("/search");
    const waitAny = lastAny === 0 ? 0 : gapMs - (now - lastAny);
    const waitSearch = isSearch && lastSearch !== 0 ? searchGapMs - (now - lastSearch) : 0;
    const wait = Math.max(waitAny, waitSearch);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const sentAt = Date.now();
    lastAny = sentAt;
    if (isSearch) lastSearch = sentAt;
    return fetchImpl(url, init);
  };
}

export function isFillPayload(payload: unknown): payload is { fill: true; nicheId?: string } {
  return Boolean(payload && typeof payload === "object" && (payload as { fill?: unknown }).fill === true);
}

export async function ensureFillPoolJob(now = new Date()) {
  if (!inFillWindow(now)) return null;
  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    logger.error("creator pool was not queued", { message: "YOUTUBE_API_KEY is not configured" });
    return null;
  }

  const busy = await prisma.processingJob.findFirst({
    where: { type: { in: [...BUSY_JOBS] }, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, type: true },
  });
  if (busy) {
    logger.info("creator pool skipped", { reason: "busy", jobType: busy.type });
    return null;
  }

  const windowStart = fillWindowStart(now);
  const [usage, tonight, limited] = await Promise.all([
    prisma.apiUsage.aggregate({
      _sum: { units: true },
      where: { provider: "youtube", createdAt: { gte: youtubeQuotaDayStart(now) } },
    }),
    prisma.searchJob.findMany({
      where: {
        createdAt: { gte: windowStart },
        processingJob: { is: { payload: { path: ["fill"], equals: true } } },
      },
      select: { quotaUsed: true, errorSummary: true },
    }),
    prisma.apiUsage.findFirst({
      where: {
        provider: "youtube",
        success: false,
        createdAt: { gte: windowStart },
        message: { contains: "rateLimit", mode: "insensitive" },
      },
      select: { id: true },
    }),
  ]);

  if (limited || stoppedByRateLimit(tonight.map((job) => job.errorSummary))) {
    logger.info("creator pool skipped", { reason: "rate-limit" });
    return null;
  }

  const daily = Number(process.env.YOUTUBE_DAILY_QUOTA || 10000);
  const consumed = usage._sum.units ?? 0;
  const tonightUsed = tonight.reduce((sum, job) => sum + job.quotaUsed, 0);
  const budget = fillRunBudget(tonightUsed, daily - consumed);
  if (budget <= 0) {
    logger.info("creator pool skipped", { reason: "budget", tonightUsed, dailyRemaining: daily - consumed });
    return null;
  }

  const niche = selectFillNiche(await fillNicheStock());
  if (!niche) return null;

  const name = `Pool · ${niche.label} · ${FILL_COUNTRY}`;
  const payload = {
    fill: true,
    nicheId: niche.id,
    keywords: [niche.query],
    countries: [FILL_COUNTRY],
    minSubscribers: MIN_CREATOR_SUBSCRIBERS,
    maxSubscribers: MAX_CREATOR_SUBSCRIBERS,
    maxResults: FILL_MAX_RESULTS,
  };
  const job = await prisma.processingJob.create({
    data: {
      type: "DISCOVER_CREATORS",
      name,
      payload,
      totalRecords: FILL_MAX_RESULTS,
    },
  });
  await prisma.searchJob.create({
    data: {
      name,
      keywords: payload.keywords,
      countries: payload.countries,
      minSubscribers: payload.minSubscribers,
      maxSubscribers: payload.maxSubscribers,
      maxResults: payload.maxResults,
      processingJobId: job.id,
    },
  });
  await enqueueProcessingJob(job.id);
  logger.info("creator pool queued", { processingJobId: job.id, niche: niche.id, usable: niche.usable, budget });
  return job.id;
}

async function fillNicheStock(): Promise<FillNiche[]> {
  const creators = await prisma.creator.findMany({
    where: {
      hidden: false,
      country: FILL_COUNTRY,
      subscriberVisibility: "PUBLIC",
      subscriberCount: { gte: MIN_CREATOR_SUBSCRIBERS, lte: MAX_CREATOR_SUBSCRIBERS },
      channelIcp: { not: Prisma.DbNull },
      lastActiveAt: { not: null },
      averageViews: { not: null },
      AND: [USABLE_CONTACT],
    },
    select: {
      channelName: true,
      channelHandle: true,
      description: true,
      subscriberCount: true,
      subscriberVisibility: true,
      averageViews: true,
      lastActiveAt: true,
    },
  });
  const usable = creators.filter((creator) =>
    qualifiesForStorage({
      lastActiveAt: creator.lastActiveAt,
      subscriberCount: creator.subscriberCount,
      subscriberVisibility: creator.subscriberVisibility,
      averageViews: creator.averageViews,
    }),
  );
  const history = await prisma.processingJob.findMany({
    where: { payload: { path: ["fill"], equals: true } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { createdAt: true, payload: true },
  });
  const lastFilled = new Map<string, number>();
  for (const job of history) {
    const payload = job.payload as { nicheId?: unknown };
    if (typeof payload.nicheId !== "string" || lastFilled.has(payload.nicheId)) continue;
    lastFilled.set(payload.nicheId, job.createdAt.getTime());
  }
  return DISCOVERY_NICHES.map((niche) => ({
    id: niche.id,
    label: niche.label,
    query: niche.query,
    usable: usable.filter(
      (creator) =>
        topicTier({
          title: creator.channelName,
          handle: creator.channelHandle,
          description: creator.description,
          videoTitle: null,
          keywords: [niche.query],
        }) === "strong",
    ).length,
    lastFilledAt: lastFilled.get(niche.id) ?? null,
  }));
}
