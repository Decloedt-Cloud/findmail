import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { canCancelJob, canRetryJob } from "@/lib/jobs/state";
import { enqueueProcessingJob, removeQueuedBullJob } from "@/lib/jobs/queue";

export async function cancelJob(id: string, userId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id } });
  if (!job) throw new ApiError(404, "Job not found");
  if (!canCancelJob(job.status)) throw new ApiError(409, "This job can no longer be cancelled");
  const queued = job.status === "QUEUED";
  await prisma.processingJob.update({
    where: { id },
    data: {
      cancelRequested: true,
      status: queued ? "CANCELLED" : job.status,
      completedAt: queued ? new Date() : job.completedAt,
    },
  });
  await prisma.searchJob.updateMany({
    where: { processingJobId: id },
    data: queued ? { cancelRequested: true, status: "CANCELLED", completedAt: new Date() } : { cancelRequested: true },
  });
  await removeQueuedBullJob(job.bullJobId);
  await audit(userId, "job.cancel", "processingJob", id);
  return prisma.processingJob.findUnique({ where: { id } });
}

export async function retryJob(id: string, userId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id } });
  if (!job) throw new ApiError(404, "Job not found");
  if (!canRetryJob(job.status)) throw new ApiError(409, "Only failed or partially completed jobs can be retried");
  await prisma.jobItem.updateMany({ where: { jobId: id, status: "FAILED" }, data: { status: "QUEUED", lastError: null } });
  await prisma.processingJob.update({
    where: { id },
    data: {
      status: "QUEUED",
      cancelRequested: false,
      completedAt: null,
      errorSummary: null,
      retryCount: { increment: 1 },
    },
  });
  await prisma.searchJob.updateMany({
    where: { processingJobId: id },
    data: { status: "QUEUED", cancelRequested: false, completedAt: null },
  });
  try {
    await enqueueProcessingJob(id);
  } catch {
    throw new ApiError(503, "Redis is required to retry this job. Start Redis and the worker, then try again.");
  }
  await audit(userId, "job.retry", "processingJob", id);
  return prisma.processingJob.findUnique({ where: { id } });
}

export async function queueJob(id: string) {
  try {
    await enqueueProcessingJob(id);
  } catch {
    throw new ApiError(503, "Redis is required for background jobs. Start Redis and the worker, then try again.");
  }
}
