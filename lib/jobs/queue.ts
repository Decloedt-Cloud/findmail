import { Queue } from "bullmq";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";

export const QUEUE_NAME = "findmail";

const globalForQueue = globalThis as unknown as { findmailQueue?: Queue };

export function getQueue() {
  const connection = getRedis();
  if (!connection) return null;
  if (!globalForQueue.findmailQueue) {
    globalForQueue.findmailQueue = new Queue(QUEUE_NAME, { connection });
  }
  return globalForQueue.findmailQueue;
}

export async function enqueueProcessingJob(processingJobId: string) {
  const queue = getQueue();
  if (!queue) {
    await prisma.processingJob.update({
      where: { id: processingJobId },
      data: {
        status: "FAILED",
        errorSummary: "REDIS_URL is not configured, so the job cannot be queued.",
        completedAt: new Date(),
      },
    });
    throw new Error("REDIS_URL is not configured");
  }
  const bullJob = await queue.add(
    "process",
    { processingJobId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 500,
    },
  );
  await prisma.processingJob.update({
    where: { id: processingJobId },
    data: { bullJobId: bullJob.id ?? processingJobId },
  });
  logger.info("job queued", { processingJobId });
}

export async function removeQueuedBullJob(bullJobId: string | null | undefined) {
  const queue = getQueue();
  if (!queue || !bullJobId) return;
  const job = await queue.getJob(bullJobId);
  const state = await job?.getState();
  if (job && (state === "waiting" || state === "delayed")) await job.remove();
}
