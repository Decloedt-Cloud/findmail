import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isCancelled, markRunning } from "@/lib/jobs/progress";
import { enqueueProcessingJob } from "@/lib/jobs/queue";
import { readUploadsFeed } from "@/lib/youtube/feed";
import { activityRecheckBefore } from "@/lib/youtube/qualify";

const BATCH = 50;
const RESUME_WINDOW_MS = 20 * 60 * 60 * 1000;

type PrunePayload = { cursor?: string | null };

function readCursor(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const cursor = (payload as PrunePayload).cursor;
  return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
}

export async function ensurePruneInactiveJob() {
  const active = await prisma.processingJob.findFirst({
    where: { type: "PRUNE_INACTIVE_CHANNELS", status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (active) return active.id;

  const latest = await prisma.processingJob.findFirst({
    where: { type: "PRUNE_INACTIVE_CHANNELS", status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] } },
    orderBy: { completedAt: "desc" },
    select: { id: true, status: true, completedAt: true },
  });
  if (latest?.status === "PARTIALLY_COMPLETED") {
    await prisma.processingJob.update({
      where: { id: latest.id },
      data: { status: "QUEUED", completedAt: null, cancelRequested: false },
    });
    await enqueueProcessingJob(latest.id);
    return latest.id;
  }
  if (latest?.status === "COMPLETED" && latest.completedAt && Date.now() - latest.completedAt.getTime() < RESUME_WINDOW_MS) {
    return latest.id;
  }

  const job = await prisma.processingJob.create({
    data: {
      type: "PRUNE_INACTIVE_CHANNELS",
      name: "Remove inactive YouTube channels",
      payload: { cursor: null },
    },
  });
  await enqueueProcessingJob(job.id);
  return job.id;
}

export async function runPruneInactiveChannels(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Prune job is missing");
  if (!(await markRunning(jobId))) return;

  const dueBefore = activityRecheckBefore();
  const due = {
    OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: dueBefore } }],
  };
  let cursor = readCursor(job.payload);
  let processed = job.processedRecords;
  let removed = job.successCount;
  let skipped = job.failureCount;
  const remaining = await prisma.creator.count({
    where: cursor ? { AND: [{ id: { gt: cursor } }, due] } : due,
  });
  const total = processed + remaining;
  let rateLimited = false;

  try {
    while (!rateLimited) {
      if (await isCancelled(jobId)) break;
      const creators = await prisma.creator.findMany({
        where: cursor ? { AND: [{ id: { gt: cursor } }, due] } : due,
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, youtubeChannelId: true },
      });
      if (creators.length === 0) break;

      for (const creator of creators) {
        if (await isCancelled(jobId)) break;
        const activity = await readUploadsFeed(creator.youtubeChannelId);
        if (activity.kind === "rate-limited") {
          rateLimited = true;
          break;
        }
        if (activity.kind === "unavailable") {
          skipped += 1;
          logger.warn("uploads feed skipped", { creatorId: creator.id, channelId: creator.youtubeChannelId });
        } else if (activity.kind === "active") {
          const published = new Date(activity.publishedAt);
          if (!Number.isNaN(published.getTime())) {
            await prisma.creator.update({
              where: { id: creator.id },
              data: { lastActiveAt: published, recentVideoPublishedAt: published, lastMetadataSyncAt: new Date() },
            });
          }
        } else {
          await prisma.jobItem.updateMany({ where: { creatorId: creator.id }, data: { creatorId: null } });
          await prisma.creator.delete({ where: { id: creator.id } });
          removed += 1;
        }
        processed += 1;
        cursor = creator.id;
      }

      await prisma.processingJob.update({
        where: { id: jobId },
        data: {
          payload: { cursor },
          processedRecords: processed,
          successCount: removed,
          failureCount: skipped,
          totalRecords: total,
          progress: total === 0 ? 100 : Math.min(99, Math.round((processed / total) * 100)),
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inactive channel sweep failed.";
    logger.error("inactive channel sweep failed", { jobId, message });
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        payload: { cursor },
        processedRecords: processed,
        successCount: removed,
        failureCount: skipped,
        totalRecords: total,
        errorSummary: message.slice(0, 800),
        completedAt: new Date(),
      },
    });
    throw error;
  }

  if (rateLimited) {
    logger.warn("inactive channel sweep paused", { jobId, processed, removed });
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        status: "PARTIALLY_COMPLETED",
        payload: { cursor },
        processedRecords: processed,
        successCount: removed,
        failureCount: skipped,
        totalRecords: total,
        errorSummary: "YouTube asked us to slow down. The sweep continues on the next run.",
        completedAt: new Date(),
      },
    });
    return;
  }

  const cancelled = await isCancelled(jobId);
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: cancelled ? "CANCELLED" : "COMPLETED",
      payload: { cursor },
      processedRecords: processed,
      successCount: removed,
      failureCount: skipped,
      totalRecords: total,
      progress: cancelled ? undefined : 100,
      errorSummary: null,
      completedAt: new Date(),
    },
  });
  logger.info("inactive channel sweep finished", { jobId, processed, removed, cancelled });
}
