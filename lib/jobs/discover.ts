import { prisma } from "@/lib/db";
import { writeChannelIcp } from "@/lib/icp/channel-icp";
import { logger } from "@/lib/logger";
import { fetchPublicPage, fetchPublicText } from "@/lib/email/crawl";
import { EmailDiscoveryService, type EmailCandidate } from "@/lib/email/discovery";
import { hunterProviderFromEnv } from "@/lib/email/providers";
import { saveDiscoveredChannel } from "@/lib/creators/store";
import { isCancelled, markRunning, recordJobError, refreshJobCounts, updateProgress } from "@/lib/jobs/progress";
import { YouTubeApiError, createYouTubeClient, matchesSearchCountry, matchesSubscriberRange } from "@/lib/youtube/client";
import type { SocialProfiles } from "@/lib/youtube/contacts";
import { discoverYouTubeChannels, topicTier, type DiscoveredChannel, type DiscoveryProgress } from "@/lib/youtube/discovery";
import { reuseLimit } from "@/lib/youtube/terms";

async function recordQuota(searchJobId: string, units: number, operation: string, success: boolean, message?: string) {
  await prisma.apiUsage.create({
    data: { provider: "youtube", operation, units, success, message: message?.slice(0, 300) },
  });
  await prisma.searchJob.update({ where: { id: searchJobId }, data: { quotaUsed: { increment: units } } });
}

function service() {
  const hunter = hunterProviderFromEnv({
    provider: process.env.CONTACT_PROVIDER,
    apiKey: process.env.CONTACT_SEARCH_API_KEY,
  });
  return new EmailDiscoveryService({
    maxPages: Number(process.env.MAX_PAGES_PER_DOMAIN || 10),
    fetchPage: fetchPublicPage,
    fetchText: fetchPublicText,
    licensedLookup: hunter.configured ? (domain) => hunter.findByDomain(domain) : undefined,
  });
}

export async function runDiscoverCreators(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId }, include: { searchJob: true } });
  if (!job?.searchJob) throw new Error("Search job is missing");
  const search = job.searchJob;
  if (!(await markRunning(jobId))) return;
  await prisma.searchJob.update({
    where: { id: search.id },
    data: { status: "RUNNING", startedAt: search.startedAt ?? new Date() },
  });

  const payload = (job.payload ?? {}) as { channels?: DiscoveredChannel[] };
  let channels = payload.channels ?? [];
  let duplicates = 0;
  let noEmail = 0;

  async function publish(progress: DiscoveryProgress) {
    const percent = Math.min(95, Math.round((progress.found / Math.max(1, search.maxResults)) * 100));
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        progress: percent,
        processedRecords: progress.found,
        totalRecords: search.maxResults,
        payload: { ...(payload as object), phase: progress.phase, scanned: progress.scanned, found: progress.found },
      },
    });
    await prisma.searchJob.update({
      where: { id: search.id },
      data: { progress: percent, processedRecords: progress.found },
    });
  }

  async function persistChannel(channel: DiscoveredChannel) {
    const key = channel.id;
    const existingItem = await prisma.jobItem.findUnique({ where: { jobId_externalKey: { jobId, externalKey: key } } });
    if (existingItem?.status === "COMPLETED") return;
    const item = existingItem
      ? await prisma.jobItem.update({ where: { id: existingItem.id }, data: { status: "RUNNING", attempts: { increment: 1 } } })
      : await prisma.jobItem.create({ data: { jobId, externalKey: key, status: "RUNNING", attempts: 1 } });
    try {
      const saved = await saveDiscoveredChannel(channel, { source: "YOUTUBE_SEARCH" });
      if (!saved.creator.channelIcp) {
        try {
          const profile = await writeChannelIcp(channel);
          await prisma.creator.update({ where: { id: saved.creator.id }, data: { channelIcp: profile } });
        } catch (error) {
          logger.error("channel icp failed", {
            creatorId: saved.creator.id,
            message: error instanceof Error ? error.message : "unknown",
          });
        }
      }
      if (saved.duplicate) duplicates += 1;
      let foundEmails = channel.descriptionEmails.length;
      const onTopic = topicTier({
        title: channel.title,
        handle: channel.customUrl,
        description: channel.description,
        videoTitle: null,
        keywords: search.keywords,
      }) === "strong";
      const missingSocial = !saved.creator.instagramUrl || !saved.creator.twitterUrl || !saved.creator.tiktokUrl;
      if (onTopic && channel.officialWebsiteUrl && (channel.descriptionEmails.length === 0 || missingSocial)) {
        const outcome = await service().discover({
          description: channel.description,
          channelUrl: saved.creator.channelUrl,
          existingWebsite: saved.creator.officialWebsiteUrl,
        });
        foundEmails = await applyEmailOutcome(saved.creator.id, outcome.website, outcome.emails, outcome.socials);
        if (foundEmails === 0) noEmail += 1;
      }
      await prisma.jobItem.update({
        where: { id: item.id },
        data: { status: "COMPLETED", creatorId: saved.creator.id, result: { duplicate: saved.duplicate, emails: foundEmails } },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save channel";
      await prisma.jobItem.update({ where: { id: item.id }, data: { status: "FAILED", lastError: message.slice(0, 500) } });
      await recordJobError(jobId, message, key, true);
    }
  }

  let reusedCount = 0;
  try {
    if (channels.length === 0) {
      const reusedIds = await attachReusableCreators(jobId, search);
      reusedCount = reusedIds.length;
      const remaining = search.maxResults - reusedCount;
      if (reusedCount > 0) await publish({ phase: "saving", scanned: reusedCount, found: reusedCount });
      if (remaining > 0) {
        const daily = Number(process.env.YOUTUBE_DAILY_QUOTA || 10000);
        const since = new Date();
        since.setUTCHours(0, 0, 0, 0);
        const used = await prisma.apiUsage.aggregate({
          _sum: { units: true },
          where: { provider: "youtube", createdAt: { gte: since } },
        });
        let consumed = used._sum.units ?? 0;
        const client = createYouTubeClient(
          fetch,
          (units, operation, success, message) => {
            consumed += units;
            return recordQuota(search.id, units, operation, success, message);
          },
          (units) => {
            if (consumed + units > daily) {
              throw new YouTubeApiError("The daily YouTube quota budget would be exceeded by the next request.", "QUOTA");
            }
          },
        );
        const discovered = await discoverYouTubeChannels(
          client,
          {
            keywords: search.keywords,
            countries: search.countries,
            language: search.language,
            minSubscribers: search.minSubscribers,
            maxSubscribers: search.maxSubscribers,
            maxResults: remaining,
            recencyDays: search.recencyDays,
            excludeChannelIds: reusedIds,
          },
          () => isCancelled(jobId),
          {
            onProgress: (progress) => publish({ ...progress, found: progress.found + reusedCount }),
            onChannel: async (channel) => {
              channels.push(channel);
              await persistChannel(channel);
            },
          },
        );
        channels = discovered.channels;
        duplicates += discovered.duplicates;
        await prisma.processingJob.update({
          where: { id: jobId },
          data: { payload: { ...(payload as object), channels, phase: "saving" }, duplicatesPrevented: duplicates, totalRecords: channels.length + reusedCount },
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube discovery failed";
    const partial = channels.length > 0 || reusedCount > 0 || (error instanceof YouTubeApiError && error.code === "QUOTA");
    await recordJobError(jobId, message, undefined, error instanceof YouTubeApiError && error.code === "RETRYABLE");
    if (error instanceof YouTubeApiError && error.code === "RETRYABLE") throw error;
    await prisma.searchJob.update({
      where: { id: search.id },
      data: { status: partial ? "PARTIALLY_COMPLETED" : "FAILED", errorSummary: message, completedAt: new Date() },
    });
    await refreshJobCounts(jobId, { duplicates, errorSummary: message });
    return;
  }

  if (await isCancelled(jobId)) {
    await prisma.searchJob.update({ where: { id: search.id }, data: { status: "CANCELLED", completedAt: new Date() } });
    await refreshJobCounts(jobId, { duplicates });
    return;
  }

  let index = 0;
  for (const channel of channels) {
    if (await isCancelled(jobId)) break;
    const existingItem = await prisma.jobItem.findUnique({ where: { jobId_externalKey: { jobId, externalKey: channel.id } } });
    if (existingItem?.status === "COMPLETED") {
      index += 1;
      continue;
    }
    await persistChannel(channel);
    index += 1;
    await updateProgress(jobId, index, channels.length);
  }

  const status = await refreshJobCounts(jobId, { noEmail, duplicates });
  const counts = await prisma.processingJob.findUnique({ where: { id: jobId }, select: { successCount: true } });
  await prisma.searchJob.update({
    where: { id: search.id },
    data: {
      status: status ?? "COMPLETED",
      progress: 100,
      totalRecords: channels.length + reusedCount,
      processedRecords: index,
      successCount: counts?.successCount ?? 0,
      noEmailCount: noEmail,
      duplicatesPrevented: duplicates,
      completedAt: new Date(),
    },
  });
}

export async function applyEmailOutcome(
  creatorId: string,
  website: { officialWebsiteUrl: string | null; websiteStatus: "FOUND" | "UNAVAILABLE"; websiteEvidence: string },
  emails: EmailCandidate[],
  socials?: SocialProfiles,
) {
  let created = 0;
  await prisma.$transaction(async (tx) => {
    const current = await tx.creator.findUnique({ where: { id: creatorId }, include: { emails: { select: { id: true } } } });
    const keepWebsite = !website.officialWebsiteUrl && current?.officialWebsiteUrl;
    const hasStoredEmail = (current?.emails.length ?? 0) > 0;
    await tx.creator.update({
      where: { id: creatorId },
      data: {
        officialWebsiteUrl: website.officialWebsiteUrl ?? current?.officialWebsiteUrl ?? null,
        websiteStatus: website.officialWebsiteUrl ? "FOUND" : keepWebsite ? current.websiteStatus : "UNAVAILABLE",
        websiteEvidence: website.officialWebsiteUrl || !keepWebsite ? website.websiteEvidence : current?.websiteEvidence,
        ...(socials?.instagram && !current?.instagramUrl ? { instagramUrl: socials.instagram } : {}),
        ...(socials?.twitter && !current?.twitterUrl ? { twitterUrl: socials.twitter } : {}),
        ...(socials?.tiktok && !current?.tiktokUrl ? { tiktokUrl: socials.tiktok } : {}),
        emailSearchStatus: emails.length > 0
          ? (emails.some((email) => email.verificationStatus === "NEEDS_REVIEW") ? "NEEDS_REVIEW" : "FOUND")
          : hasStoredEmail
            ? current?.emailSearchStatus === "NOT_SEARCHED" ? "FOUND" : current?.emailSearchStatus
            : "NOT_FOUND",
      },
    });
    for (const candidate of emails) {
      const existing = await tx.emailContact.findUnique({
        where: { creatorId_normalizedEmail: { creatorId, normalizedEmail: candidate.normalizedEmail } },
      });
      if (existing) {
        await tx.dedupEvent.create({
          data: { kind: "email", key: `${creatorId}:${candidate.normalizedEmail}`, source: candidate.sourceType },
        });
        continue;
      }
      await tx.emailContact.create({
        data: {
          creatorId,
          emailAddress: candidate.emailAddress,
          normalizedEmail: candidate.normalizedEmail,
          sourceUrl: candidate.sourceUrl,
          sourceType: candidate.sourceType,
          extractionMethod: candidate.extractionMethod,
          confidenceStatus: candidate.confidenceStatus,
          verificationStatus: candidate.verificationStatus,
          isOnOfficialDomain: candidate.isOnOfficialDomain,
          isGenericInbox: candidate.isGenericInbox,
          pageTitle: candidate.pageTitle,
          provenanceNote: sourceNote(candidate.sourceType),
        },
      });
      created += 1;
    }
  });
  return created;
}

async function attachReusableCreators(
  jobId: string,
  search: {
    keywords: string[];
    countries: string[];
    minSubscribers: number | null;
    maxSubscribers: number | null;
    maxResults: number;
  },
) {
  const rows = await prisma.creator.findMany({
    where: { hidden: false, emails: { some: {} } },
    orderBy: [{ relevanceScore: "desc" }, { discoveredAt: "desc" }],
    take: 300,
    select: {
      id: true,
      youtubeChannelId: true,
      channelName: true,
      channelHandle: true,
      description: true,
      country: true,
      discoveryRegion: true,
      subscriberCount: true,
      subscriberVisibility: true,
    },
  });
  const limit = reuseLimit(search.maxResults);
  const chosen = [];
  for (const creator of rows) {
    if (chosen.length >= limit) break;
    const tier = topicTier({
      title: creator.channelName,
      handle: creator.channelHandle,
      description: creator.description,
      videoTitle: null,
      keywords: search.keywords,
    });
    if (tier !== "strong") continue;
    if (!matchesSearchCountry(creator, search.countries)) continue;
    if (!matchesSubscriberRange(creator.subscriberVisibility, creator.subscriberCount, search.minSubscribers, search.maxSubscribers)) continue;
    chosen.push(creator);
  }
  for (const creator of chosen) {
    const existing = await prisma.jobItem.findUnique({
      where: { jobId_externalKey: { jobId, externalKey: creator.youtubeChannelId } },
    });
    if (existing?.status === "COMPLETED") continue;
    if (existing) {
      await prisma.jobItem.update({
        where: { id: existing.id },
        data: { status: "COMPLETED", creatorId: creator.id, result: { reused: true } },
      });
    } else {
      await prisma.jobItem.create({
        data: {
          jobId,
          externalKey: creator.youtubeChannelId,
          status: "COMPLETED",
          creatorId: creator.id,
          attempts: 0,
          result: { reused: true },
        },
      });
    }
  }
  return chosen.map((creator) => creator.youtubeChannelId);
}

function sourceNote(sourceType: string) {
  if (sourceType === "CHANNEL_DESCRIPTION") {
    return "Published in the channel description returned as public metadata. This is not YouTube's private contact-email field.";
  }
  if (sourceType === "LICENSED_PROVIDER") return "Returned by the configured licensed contact provider. Not marked verified.";
  if (sourceType === "MAILTO") return "Extracted from a public mailto link.";
  return "Extracted from a public page on a website or link hub published by the creator.";
}

export async function runEmailDiscovery(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (!(await markRunning(jobId))) return;
  const creatorIds = Array.isArray((job.payload as { creatorIds?: string[] }).creatorIds)
    ? (job.payload as { creatorIds: string[] }).creatorIds
    : [];
  await prisma.processingJob.update({ where: { id: jobId }, data: { totalRecords: creatorIds.length } });
  const discovery = service();
  let index = 0;
  let noEmail = 0;
  let duplicates = 0;
  for (const creatorId of creatorIds) {
    if (await isCancelled(jobId)) break;
    const existing = await prisma.jobItem.findUnique({
      where: { jobId_externalKey: { jobId, externalKey: creatorId } },
    });
    if (existing?.status === "COMPLETED") {
      index += 1;
      continue;
    }
    const item = existing
      ? await prisma.jobItem.update({ where: { id: existing.id }, data: { status: "RUNNING", attempts: { increment: 1 } } })
      : await prisma.jobItem.create({ data: { jobId, externalKey: creatorId, creatorId, status: "RUNNING", attempts: 1 } });
    try {
      const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
      if (!creator || creator.hidden) throw new Error("Creator not found");
      const outcome = await discovery.discover({
        description: creator.description,
        channelUrl: creator.channelUrl,
        existingWebsite: creator.officialWebsiteUrl,
      });
      const created = await applyEmailOutcome(creator.id, outcome.website, outcome.emails, outcome.socials);
      if (outcome.emails.length === 0) noEmail += 1;
      duplicates += Math.max(0, outcome.emails.length - created);
      await prisma.jobItem.update({
        where: { id: item.id },
        data: { status: "COMPLETED", result: { emails: outcome.emails.length, notes: outcome.notes.slice(0, 8) } },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email discovery failed";
      await prisma.jobItem.update({ where: { id: item.id }, data: { status: "FAILED", lastError: message.slice(0, 500) } });
      await recordJobError(jobId, message, creatorId, true);
    }
    index += 1;
    await updateProgress(jobId, index, creatorIds.length);
  }
  await refreshJobCounts(jobId, { noEmail, duplicates });
}
