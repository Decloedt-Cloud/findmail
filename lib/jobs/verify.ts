import { prisma } from "@/lib/db";
import { statusFromVerificationResult, transitionEmailStatus, type EmailVerificationStatus } from "@/lib/email/status";
import { verificationProviderFromEnv } from "@/lib/email/providers";
import { isCancelled, markRunning, recordJobError, refreshJobCounts, updateProgress } from "@/lib/jobs/progress";

export async function runVerify(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (!(await markRunning(jobId))) return;
  const provider = verificationProviderFromEnv({
    provider: process.env.EMAIL_VERIFICATION_PROVIDER,
    apiKey: process.env.EMAIL_VERIFICATION_API_KEY,
  });
  const emailIds = Array.isArray((job.payload as { emailIds?: string[] }).emailIds)
    ? (job.payload as { emailIds: string[] }).emailIds
    : [];
  if (!provider.configured) {
    const message = "No email verification provider is configured. Add EMAIL_VERIFICATION_PROVIDER and EMAIL_VERIFICATION_API_KEY. Nothing was marked verified.";
    await recordJobError(jobId, message, undefined, false);
    await prisma.processingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", errorSummary: message, totalRecords: emailIds.length, completedAt: new Date() },
    });
    return;
  }

  let index = 0;
  for (const emailId of emailIds) {
    if (await isCancelled(jobId)) break;
    const existing = await prisma.jobItem.findUnique({ where: { jobId_externalKey: { jobId, externalKey: emailId } } });
    if (existing?.status === "COMPLETED") {
      index += 1;
      continue;
    }
    const item = existing
      ? await prisma.jobItem.update({ where: { id: existing.id }, data: { status: "RUNNING", attempts: { increment: 1 } } })
      : await prisma.jobItem.create({ data: { jobId, externalKey: emailId, status: "RUNNING", attempts: 1 } });
    try {
      const email = await prisma.emailContact.findUnique({ where: { id: emailId } });
      if (!email) throw new Error("Email contact not found");
      const result = await provider.verify(email.normalizedEmail);
      const next = transitionEmailStatus(email.verificationStatus as EmailVerificationStatus, statusFromVerificationResult(result.outcome));
      await prisma.emailContact.update({
        where: { id: email.id },
        data: {
          verificationStatus: next,
          verificationProvider: provider.id,
          verifiedAt: new Date(),
          provenanceNote: `Verification status ${next} came from ${provider.id} (${result.rawStatus}). Syntax checks and provider results are not proof of consent.`,
        },
      });
      await prisma.jobItem.update({ where: { id: item.id }, data: { status: "COMPLETED", creatorId: email.creatorId, result: { status: next, provider: provider.id } } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed";
      await prisma.jobItem.update({ where: { id: item.id }, data: { status: "FAILED", lastError: message.slice(0, 500) } });
      await recordJobError(jobId, message, emailId, true);
    }
    index += 1;
    await updateProgress(jobId, index, emailIds.length);
  }
  await refreshJobCounts(jobId);
}
