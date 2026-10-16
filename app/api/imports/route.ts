import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs/actions";
import { insideDir, paths } from "@/lib/paths";
import { importConfirmSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`import:${user.id}`, 20, 60 * 60 * 1000);
    const input = importConfirmSchema.parse(await readJson(request));
    const values = Object.values(input.mapping);
    if (!values.some((field) => field === "channel_id" || field === "channel_url" || field === "video_url")) {
      throw new ApiError(400, "Map a channel id, channel URL, or video URL column before importing");
    }
    const metaPath = path.join(paths.uploads, `${input.token}.json`);
    const csvPath = path.join(paths.uploads, `${input.token}.csv`);
    if (!insideDir(paths.uploads, metaPath) || !insideDir(paths.uploads, csvPath)) throw new ApiError(400, "Import token is not valid");
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as { fileName?: string; userId?: string };
    if (meta.userId !== user.id && user.role !== "ADMIN") throw new ApiError(403, "You do not have access to this upload");
    const job = await prisma.processingJob.create({
      data: {
        type: "IMPORT_CHANNELS",
        name: `Import ${meta.fileName || "channels.csv"}`,
        userId: user.id,
        payload: { token: input.token, duplicateStrategy: input.duplicateStrategy },
      },
    });
    const batch = await prisma.importBatch.create({
      data: {
        fileName: meta.fileName || "channels.csv",
        storedFilePath: csvPath,
        duplicateStrategy: input.duplicateStrategy,
        columnMapping: input.mapping,
        userId: user.id,
        processingJobId: job.id,
      },
    });
    await queueJob(job.id);
    await audit(user.id, "import.start", "importBatch", batch.id);
    return NextResponse.json({ import: batch, processingJobId: job.id }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
