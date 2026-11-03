import { unlink } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runMatchIcpChannels } from "@/lib/icp/run";
import { runDiscoverCreators, runEmailDiscovery } from "@/lib/jobs/discover";
import { runExport } from "@/lib/jobs/export";
import { runImport } from "@/lib/jobs/import";
import { runPruneInactiveChannels } from "@/lib/jobs/prune-inactive";
import { runVerify } from "@/lib/jobs/verify";

export async function applyRetention() {
  const [exportSetting, creatorSetting] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: "exportRetentionDays" } }),
    prisma.appSetting.findUnique({ where: { key: "creatorRetentionDays" } }),
  ]);
  const exportDays = Number(exportSetting?.value ?? 30);
  const creatorDays = Number(creatorSetting?.value ?? 0);
  const exportCutoff = new Date(Date.now() - Math.max(1, exportDays) * 24 * 60 * 60 * 1000);
  const expired = await prisma.exportRecord.findMany({
    where: {
      filePath: { not: null },
      OR: [{ expiresAt: { lt: new Date() } }, { expiresAt: null, createdAt: { lt: exportCutoff } }],
    },
  });
  for (const record of expired) {
    if (record.filePath) await unlink(record.filePath).catch(() => undefined);
    await prisma.exportRecord.update({ where: { id: record.id }, data: { filePath: null } });
  }
  if (creatorDays > 0) {
    const cutoff = new Date(Date.now() - creatorDays * 24 * 60 * 60 * 1000);
    await prisma.creator.deleteMany({ where: { discoveredAt: { lt: cutoff } } });
  }
}

export async function runProcessingJob(processingJobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: processingJobId } });
  if (!job || job.status === "COMPLETED" || job.status === "CANCELLED") return;
  await applyRetention().catch((error) => {
    logger.warn("retention skipped", { message: error instanceof Error ? error.message : "unknown" });
  });
  switch (job.type) {
    case "DISCOVER_CREATORS":
      await runDiscoverCreators(processingJobId);
      return;
    case "IMPORT_CHANNELS":
      await runImport(processingJobId);
      return;
    case "DISCOVER_WEBSITES":
    case "FIND_CONTACT_PAGES":
    case "EXTRACT_EMAILS":
      await runEmailDiscovery(processingJobId);
      return;
    case "VERIFY_EMAILS":
      await runVerify(processingJobId);
      return;
    case "EXPORT_RESULTS":
      await runExport(processingJobId);
      return;
    case "MATCH_ICP_CHANNELS":
      await runMatchIcpChannels(processingJobId);
      return;
    case "PRUNE_INACTIVE_CHANNELS":
      await runPruneInactiveChannels(processingJobId);
      return;
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}
