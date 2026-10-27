import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { EmailContact, Prisma } from "@prisma/client";
import { EXPORT_COLUMNS } from "@/lib/constants";
import { pickPrimaryEmail } from "@/lib/creators/email";
import { creatorInclude, creatorWhere, type CreatorFilters } from "@/lib/creators/query";
import { encodeCsvCell } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { isCancelled, markRunning, recordJobError, refreshJobCounts } from "@/lib/jobs/progress";
import { ensureDataDirs, insideDir, paths } from "@/lib/paths";
import { assertCanAccess } from "@/lib/authz";

function writeLine(stream: ReturnType<typeof createWriteStream>, cells: unknown[]) {
  return new Promise<void>((resolve, reject) => {
    stream.write(`${cells.map((cell) => encodeCsvCell(cell)).join(",")}\r\n`, (error) => (error ? reject(error) : resolve()));
  });
}

export function exportCells(
  creator: {
    channelName: string;
    youtubeChannelId: string;
    channelUrl: string;
    country: string | null;
    subscriberCount: number | null;
    subscriberVisibility: string;
    officialWebsiteUrl: string | null;
    emailSearchStatus: string;
    channelHandle?: string | null;
    averageViews?: number | null;
    averageViewsMethod?: string | null;
    lastActiveAt?: Date | string | null;
    instagramUrl?: string | null;
    twitterUrl?: string | null;
    tiktokUrl?: string | null;
    matchedVideoTitle?: string | null;
    matchedVideoUrl?: string | null;
    matchedVideoViews?: number | null;
    matchedVideoPublishedAt?: Date | string | null;
  },
  email: Pick<EmailContact, "emailAddress" | "verificationStatus" | "sourceUrl" | "discoveredAt"> | null,
) {
  return [
    creator.channelName,
    bareHandle(creator.channelHandle),
    creator.channelUrl,
    creator.subscriberVisibility === "PUBLIC" && creator.subscriberCount != null ? creator.subscriberCount : "",
    creator.averageViews ?? "",
    email?.emailAddress ?? "",
    creator.officialWebsiteUrl ?? "",
    creator.instagramUrl ?? "",
    creator.twitterUrl ?? "",
    creator.tiktokUrl ?? "",
    isoUtc(creator.lastActiveAt),
    creator.matchedVideoTitle ?? "",
    creator.matchedVideoUrl ?? "",
    creator.matchedVideoViews ?? "",
    isoUtc(creator.matchedVideoPublishedAt),
  ];
}

function bareHandle(value: string | null | undefined) {
  return value ? value.replace(/^@/, "") : "";
}

function isoUtc(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export async function runExport(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId }, include: { exportRecord: true } });
  if (!job?.exportRecord) throw new Error("Export record is missing");
  if (!(await markRunning(jobId))) return;
  const record = job.exportRecord;
  await prisma.exportRecord.update({ where: { id: record.id }, data: { status: "RUNNING" } });
  try {
    const where = await exportWhere(job.userId, record.scope, record.filters, job.payload);
    await ensureDataDirs();
    const filePath = path.join(paths.exports, `${record.id}.csv`);
    if (!insideDir(paths.exports, filePath)) throw new Error("Export path is not allowed");
    const stream = createWriteStream(filePath, { encoding: "utf8" });
    await writeLine(stream, ["\uFEFF" + EXPORT_COLUMNS[0], ...EXPORT_COLUMNS.slice(1)]);
    let rows = 0;
    let cursor: string | undefined;
    while (true) {
      if (await isCancelled(jobId)) {
        stream.end();
        await unlink(filePath).catch(() => undefined);
        await refreshJobCounts(jobId, { errorSummary: "Export cancelled" });
        await prisma.exportRecord.update({ where: { id: record.id }, data: { status: "CANCELLED", completedAt: new Date(), filePath: null } });
        return;
      }
      const batch = await prisma.creator.findMany({
        where,
        include: creatorInclude,
        orderBy: { id: "asc" },
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (batch.length === 0) break;
      for (const creator of batch) {
        const eligible = eligibleEmails(record.scope, creator.emails);
        if (record.scope !== "WITHOUT_EMAIL" && eligible.length === 0) continue;
        const primary = pickPrimaryEmail(eligible);
        const email = record.scope === "WITHOUT_EMAIL" ? null : primary;
        if (record.scope !== "WITHOUT_EMAIL" && !email) continue;
        await writeLine(stream, exportCells(creator, email));
        rows += 1;
      }
      cursor = batch[batch.length - 1]?.id;
      await prisma.processingJob.update({ where: { id: jobId }, data: { processedRecords: rows, successCount: rows, progress: batch.length < 200 ? 100 : 50 } });
    }
    await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
    const retention = await prisma.appSetting.findUnique({ where: { key: "exportRetentionDays" } });
    const days = Number(retention?.value ?? 30);
    await prisma.exportRecord.update({
      where: { id: record.id },
      data: {
        status: "COMPLETED",
        filePath,
        rowCount: rows,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.jobItem.upsert({
      where: { jobId_externalKey: { jobId, externalKey: "export" } },
      create: { jobId, externalKey: "export", status: "COMPLETED", result: { rows } },
      update: { status: "COMPLETED", result: { rows } },
    });
    await refreshJobCounts(jobId);
    await prisma.processingJob.update({ where: { id: jobId }, data: { successCount: rows, processedRecords: rows, totalRecords: rows, status: "COMPLETED", progress: 100 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    await recordJobError(jobId, message, undefined, false);
    await refreshJobCounts(jobId, { errorSummary: message });
    await prisma.exportRecord.update({ where: { id: record.id }, data: { status: "FAILED", completedAt: new Date() } });
  }
}

function eligibleEmails<T extends { verificationStatus: string }>(scope: string, emails: T[]) {
  if (scope === "VERIFIED_ONLY") return emails.filter((email) => email.verificationStatus === "VERIFIED");
  if (scope === "WITHOUT_EMAIL") return [];
  return emails.filter((email) => email.verificationStatus !== "INVALID");
}

async function exportWhere(userId: string | null, scope: string, filters: Prisma.JsonValue, payload: Prisma.JsonValue): Promise<Prisma.CreatorWhereInput> {
  const body = (filters ?? {}) as CreatorFilters & { creatorIds?: string[]; listId?: string; jobId?: string };
  const extra = (payload ?? {}) as { creatorIds?: string[]; listId?: string; jobId?: string };
  if (scope === "SELECTED") {
    const ids = extra.creatorIds ?? body.creatorIds ?? [];
    if (ids.length === 0) throw new Error("Select at least one creator to export");
    return creatorWhere({ ids, includeHidden: false });
  }
  if (scope === "CONTACT_LIST") {
    const listId = extra.listId ?? body.listId;
    if (!listId) throw new Error("A contact list is required");
    const list = await prisma.contactList.findUnique({ where: { id: listId } });
    if (!list) throw new Error("Contact list not found");
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) assertCanAccess(user, list.userId);
    }
    return creatorWhere({ listId, includeHidden: false });
  }
  if (scope === "JOB") {
    const sourceJobId = extra.jobId ?? body.jobId;
    if (!sourceJobId) throw new Error("A processing job is required");
    const items = await prisma.jobItem.findMany({ where: { jobId: sourceJobId, creatorId: { not: null } }, select: { creatorId: true } });
    return creatorWhere({ ids: items.map((item) => item.creatorId).filter((id): id is string => Boolean(id)) });
  }
  const base = creatorWhere({
    q: body.q,
    country: body.country,
    emailStatus: body.emailStatus,
    minSubscribers: body.minSubscribers,
    maxSubscribers: body.maxSubscribers,
  });
  if (scope === "WITH_EMAIL") return { AND: [base, { emails: { some: {} } }] };
  if (scope === "VERIFIED_ONLY") return { AND: [base, { emails: { some: { verificationStatus: "VERIFIED" } } }] };
  if (scope === "WITHOUT_EMAIL") return { AND: [base, { emails: { none: {} } }] };
  return base;
}
