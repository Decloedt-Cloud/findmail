import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DuplicateStrategy } from "@prisma/client";
import { assessEmail } from "@/lib/email/normalize";
import { provenanceNote } from "@/lib/creators/email";
import { mapImportRows, parseCsv, toCsv, type CsvField, type ImportRow } from "@/lib/csv";
import { prisma, isUniqueViolation } from "@/lib/db";
import { isCancelled, markRunning, recordJobError, refreshJobCounts, updateProgress } from "@/lib/jobs/progress";
import { ensureDataDirs, paths } from "@/lib/paths";
import { assertPublicHttpUrl } from "@/lib/ssrf";
import { YouTubeApiError, createYouTubeClient, parseYouTubeReference } from "@/lib/youtube/client";

type StoredRow = { input?: ImportRow };

export async function runImport(jobId: string) {
  const job = await prisma.processingJob.findUnique({ where: { id: jobId }, include: { importBatch: true } });
  if (!job?.importBatch) throw new Error("Import batch is missing");
  if (!(await markRunning(jobId))) return;
  const batch = job.importBatch;
  await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "RUNNING" } });

  const pending = await prisma.jobItem.count({ where: { jobId } });
  if (pending === 0) {
    const text = await readFile(batch.storedFilePath, "utf8");
    const { rows, errors } = prepareRows(text, batch.columnMapping as Record<string, string>);
    await prisma.processingJob.update({ where: { id: jobId }, data: { totalRecords: rows.length + errors.length } });
    await prisma.importBatch.update({ where: { id: batch.id }, data: { totalRows: rows.length + errors.length } });
    if (errors.length > 0) {
      await prisma.jobItem.createMany({
        data: errors.map((error) => ({
          jobId,
          externalKey: `row:${error.rowNumber}`,
          status: "FAILED" as const,
          lastError: error.message,
          attempts: 1,
        })),
      });
      for (const error of errors) await recordJobError(jobId, error.message, `row:${error.rowNumber}`, false);
    }
    await prisma.jobItem.createMany({
      data: rows.map((row) => ({
        jobId,
        externalKey: `row:${row.rowNumber}`,
        status: "QUEUED" as const,
        result: { input: row },
      })),
    });
  }

  const items = await prisma.jobItem.findMany({ where: { jobId, status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { externalKey: "asc" } });
  const total = await prisma.jobItem.count({ where: { jobId } });
  let index = total - items.length;
  let duplicates = 0;
  for (const item of items) {
    if (await isCancelled(jobId)) break;
    const row = (item.result as StoredRow | null)?.input;
    if (!row) continue;
    await prisma.jobItem.update({ where: { id: item.id }, data: { status: "RUNNING", attempts: { increment: 1 } } });
    try {
      const saved = await importRow(row, batch.duplicateStrategy);
      if (saved.duplicate) duplicates += 1;
      await prisma.jobItem.update({
        where: { id: item.id },
        data: { status: "COMPLETED", creatorId: saved.creatorId, result: { input: row, duplicate: saved.duplicate } },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import row failed";
      const retryable = error instanceof YouTubeApiError && error.code === "RETRYABLE";
      await prisma.jobItem.update({ where: { id: item.id }, data: { status: "FAILED", lastError: message.slice(0, 500), result: { input: row } } });
      await recordJobError(jobId, message, item.externalKey, retryable);
      if (error instanceof YouTubeApiError && error.code === "QUOTA") {
        await refreshJobCounts(jobId, { duplicates, errorSummary: message });
        await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "PARTIALLY_COMPLETED", duplicateCount: duplicates, completedAt: new Date() } });
        return;
      }
    }
    index += 1;
    await updateProgress(jobId, index, total);
  }

  await ensureDataDirs();
  const failed = await prisma.jobItem.findMany({ where: { jobId, status: "FAILED" }, orderBy: { externalKey: "asc" } });
  let errorReportPath: string | null = null;
  if (failed.length > 0) {
    errorReportPath = path.join(paths.imports, `${batch.id}-errors.csv`);
    await writeFile(errorReportPath, toCsv(["record", "message"], failed.map((item) => [item.externalKey, item.lastError ?? ""])), "utf8");
  }
  const status = await refreshJobCounts(jobId, { duplicates });
  const success = await prisma.jobItem.count({ where: { jobId, status: "COMPLETED" } });
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: status ?? "COMPLETED",
      processedRows: index,
      successCount: success,
      errorCount: failed.length,
      duplicateCount: duplicates,
      errorReportPath,
      completedAt: new Date(),
    },
  });
}

function prepareRows(text: string, mapping: Record<string, string>) {
  const table = parseCsv(text);
  const numericMapping: Record<number, CsvField> = {};
  for (const [key, value] of Object.entries(mapping)) numericMapping[Number(key)] = value as CsvField;
  const mapped = mapImportRows(table, numericMapping);
  const rows: ImportRow[] = [];
  const errors = [...mapped.errors];
  for (const row of mapped.rows) {
    const issue = validateRow(row);
    if (issue) errors.push({ rowNumber: row.rowNumber, message: issue });
    else rows.push(row);
  }
  return { rows, errors };
}

function validateRow(row: ImportRow) {
  if (!row.channelId && !row.channelUrl && !row.videoUrl) return "A channel id, channel URL, or video URL is required";
  if (row.country && !/^[A-Z]{2}$/.test(row.country)) return "Country must be a 2-letter code";
  if (row.websiteUrl) {
    try {
      assertPublicHttpUrl(row.websiteUrl);
    } catch (error) {
      return error instanceof Error ? error.message : "Website URL is not allowed";
    }
  }
  if (row.email) {
    const assessment = assessEmail(row.email);
    if (!assessment.validSyntax || assessment.placeholder) return assessment.reason ?? "Invalid email";
  }
  return null;
}

async function importRow(row: ImportRow, strategy: DuplicateStrategy) {
  let channelId = row.channelId;
  let resolvedName = row.channelName;
  let description: string | null = null;
  let thumbnailUrl: string | null = null;
  let handle: string | null = null;
  const reference = parseYouTubeReference(row.channelUrl || row.videoUrl || row.channelId || "");
  if (!channelId && reference.channelId) channelId = reference.channelId;
  if (!channelId && (reference.videoId || reference.handle)) {
    const client = createYouTubeClient(fetch, async (units, operation, success, message) => {
      await prisma.apiUsage.create({ data: { provider: "youtube", operation, units, success, message } });
    });
    if (reference.videoId) channelId = await client.channelIdForVideo(reference.videoId);
    if (!channelId && reference.handle) {
      const channel = await client.channelForHandle(reference.handle);
      channelId = channel?.id ?? null;
      resolvedName = resolvedName || channel?.title || null;
      description = channel?.description ?? null;
      thumbnailUrl = channel?.thumbnailUrl ?? null;
      handle = channel?.customUrl ?? reference.handle;
    }
  }
  if (!channelId) throw new Error("Could not determine a YouTube channel id");
  handle = handle ?? reference.handle ?? null;

  const existing = await prisma.creator.findUnique({ where: { youtubeChannelId: channelId } });
  if (existing && strategy === "SKIP") {
    await prisma.dedupEvent.create({ data: { kind: "channel", key: channelId, source: "csv-import" } });
    return { creatorId: existing.id, duplicate: true };
  }

  const website = row.websiteUrl ? assertPublicHttpUrl(row.websiteUrl).toString() : null;
  const createData = {
    youtubeChannelId: channelId,
    channelName: resolvedName || existing?.channelName || channelId,
    channelHandle: handle,
    channelUrl: row.channelUrl || `https://www.youtube.com/channel/${channelId}`,
    description,
    country: row.country,
    subscriberCount: row.subscriberCount,
    subscriberVisibility: row.subscriberCount == null ? ("UNAVAILABLE" as const) : ("PUBLIC" as const),
    thumbnailUrl,
    officialWebsiteUrl: website,
    websiteStatus: website ? ("FOUND" as const) : ("UNKNOWN" as const),
    websiteEvidence: website ? "Website URL supplied in the imported CSV." : null,
    discoverySource: "CSV_IMPORT" as const,
    discoveredAt: new Date(),
  };

  let creatorId: string;
  let duplicate = false;
  if (!existing) {
    try {
      const created = await prisma.creator.create({ data: createData });
      creatorId = created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      duplicate = true;
      const raced = await prisma.creator.findUniqueOrThrow({ where: { youtubeChannelId: channelId } });
      creatorId = raced.id;
    }
  } else {
    duplicate = true;
    await prisma.dedupEvent.create({ data: { kind: "channel", key: channelId, source: "csv-import" } });
    const merged = strategy === "MERGE"
      ? {
          channelName: existing.channelName || createData.channelName,
          country: existing.country ?? createData.country,
          officialWebsiteUrl: existing.officialWebsiteUrl ?? website,
          websiteStatus: existing.officialWebsiteUrl ? existing.websiteStatus : createData.websiteStatus,
          subscriberCount: existing.subscriberCount ?? createData.subscriberCount,
          subscriberVisibility: existing.subscriberCount == null ? createData.subscriberVisibility : existing.subscriberVisibility,
          channelUrl: existing.channelUrl || createData.channelUrl,
        }
      : {
          channelName: createData.channelName,
          channelUrl: createData.channelUrl,
          country: createData.country,
          subscriberCount: createData.subscriberCount,
          subscriberVisibility: createData.subscriberVisibility,
          officialWebsiteUrl: website ?? existing.officialWebsiteUrl,
          websiteStatus: website ? ("FOUND" as const) : existing.websiteStatus,
          websiteEvidence: website ? createData.websiteEvidence : existing.websiteEvidence,
        };
    await prisma.creator.update({ where: { id: existing.id }, data: merged });
    creatorId = existing.id;
  }

  if (row.email) {
    const assessment = assessEmail(row.email);
    if (assessment.validSyntax && !assessment.placeholder) {
      const existingEmail = await prisma.emailContact.findUnique({
        where: { creatorId_normalizedEmail: { creatorId, normalizedEmail: assessment.normalized } },
      });
      if (existingEmail) {
        await prisma.dedupEvent.create({ data: { kind: "email", key: `${creatorId}:${assessment.normalized}`, source: "csv-import" } });
      } else {
        await prisma.emailContact.create({
          data: {
            creatorId,
            emailAddress: assessment.normalized,
            normalizedEmail: assessment.normalized,
            sourceType: "CSV_IMPORT",
            extractionMethod: "CSV_COLUMN",
            confidenceStatus: "MEDIUM",
            verificationStatus: "SYNTAX_VALID",
            isGenericInbox: assessment.genericInbox,
            provenanceNote: provenanceNote("CSV_IMPORT"),
          },
        });
        await prisma.creator.update({ where: { id: creatorId }, data: { emailSearchStatus: "FOUND" } });
      }
    }
  }
  return { creatorId, duplicate };
}
