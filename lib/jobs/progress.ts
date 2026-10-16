import { prisma } from "@/lib/db";
import { progressPercent, resolveCompletionStatus } from "@/lib/jobs/state";

export async function isCancelled(jobId: string) {
  const job = await prisma.processingJob.findUnique({
    where: { id: jobId },
    select: { cancelRequested: true, status: true },
  });
  return !job || job.cancelRequested || job.status === "CANCELLED";
}

export async function markRunning(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) return false;
  if (job.status === "COMPLETED" || job.status === "CANCELLED") return false;
  if (job.cancelRequested && job.status === "QUEUED") {
    await prisma.processingJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", completedAt: new Date(), progress: job.progress },
    });
    return false;
  }
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: job.startedAt ?? new Date() },
  });
  return true;
}

export async function recordJobError(jobId: string, message: string, recordKey?: string, retryable = false) {
  await prisma.jobError.create({
    data: { jobId, message: message.slice(0, 800), recordKey, retryable },
  });
}

export async function refreshJobCounts(jobId: string, extra?: { noEmail?: number; duplicates?: number; errorSummary?: string | null }) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const items = await prisma.jobItem.groupBy({
    by: ["status"],
    where: { jobId },
    _count: { _all: true },
  });
  const count = (status: string) => items.find((item) => item.status === status)?._count._all ?? 0;
  const success = count("COMPLETED");
  const failed = count("FAILED");
  const processed = success + failed + count("CANCELLED");
  const total = Math.max(job.totalRecords, items.reduce((sum, item) => sum + item._count._all, 0));
  const cancel = job.cancelRequested;
  const status = resolveCompletionStatus({ cancelRequested: cancel, success, failed });
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status,
      progress: progressPercent(processed, total),
      processedRecords: processed,
      successCount: success,
      failureCount: failed,
      totalRecords: total,
      noEmailCount: extra?.noEmail ?? job.noEmailCount,
      duplicatesPrevented: extra?.duplicates ?? job.duplicatesPrevented,
      errorSummary: extra?.errorSummary === undefined ? job.errorSummary : extra.errorSummary,
      completedAt: new Date(),
    },
  });
  return status;
}

export async function updateProgress(jobId: string, processed: number, total: number) {
  await prisma.processingJob.update({
    where: { id: jobId },
    data: { processedRecords: processed, totalRecords: total, progress: progressPercent(processed, total) },
  });
}
