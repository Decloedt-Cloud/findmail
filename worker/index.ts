import "@/lib/load-env";
import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { ensurePruneInactiveJob } from "@/lib/jobs/prune-inactive";
import { runProcessingJob } from "@/lib/jobs/runner";
import { QUEUE_NAME, getQueue } from "@/lib/jobs/queue";
import { getRedis } from "@/lib/redis";

const connection = getRedis();
if (!connection) {
  logger.error("worker stopped", { message: "REDIS_URL is not configured" });
  process.exit(1);
}

const concurrency = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 5));
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === "schedule-prune-inactive") {
      await ensurePruneInactiveJob();
      return;
    }
    await runProcessingJob(String(job.data.processingJobId));
  },
  { connection, concurrency },
);

worker.on("failed", async (job, error) => {
  if (!job) return;
  if (job.name === "schedule-prune-inactive") {
    logger.error("inactive channel sweep was not queued", { message: error.message });
    return;
  }
  const maxAttempts = job.opts.attempts ?? 1;
  logger.error("job failed", { processingJobId: job.data.processingJobId, attempts: job.attemptsMade, message: error.message });
  if (job.attemptsMade >= maxAttempts) {
    await prisma.processingJob.updateMany({
      where: { id: String(job.data.processingJobId), status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", errorSummary: error.message.slice(0, 800), completedAt: new Date(), retryCount: job.attemptsMade },
    });
  } else {
    await prisma.processingJob.updateMany({
      where: { id: String(job.data.processingJobId) },
      data: { retryCount: job.attemptsMade },
    });
  }
});

worker.on("completed", (job) => {
  logger.info("job finished", { processingJobId: job.data.processingJobId });
});

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

async function start() {
  const queue = getQueue();
  if (queue) {
    await queue.upsertJobScheduler(
      "prune-inactive-channels",
      { pattern: "15 4 * * *" },
      { name: "schedule-prune-inactive", data: {} },
    );
    await ensurePruneInactiveJob().catch((error) => {
      logger.error("inactive channel sweep was not queued", { message: error instanceof Error ? error.message : "unknown" });
    });
  }
  logger.info("worker started", { concurrency });
}

void start().catch((error) => {
  logger.error("worker stopped", { message: error instanceof Error ? error.message : "unknown" });
  process.exit(1);
});
