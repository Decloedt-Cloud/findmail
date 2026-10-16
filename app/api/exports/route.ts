import { NextResponse } from "next/server";
import { ApiError, enforceRateLimit, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { queueJob } from "@/lib/jobs/actions";
import { exportSchema } from "@/lib/schemas";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
    const where = user.role === "ADMIN" ? {} : { userId: user.id };
    const [total, exports] = await prisma.$transaction([
      prisma.exportRecord.count({ where }),
      prisma.exportRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { processingJob: { select: { errorSummary: true } } },
      }),
    ]);
    return NextResponse.json({
      exports: exports.map(({ processingJob, ...record }) => ({
        ...record,
        errorSummary: processingJob?.errorSummary ?? null,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`export:${user.id}`, 30, 60 * 60 * 1000);
    const input = exportSchema.parse(await readJson(request));
    if (input.scope === "SELECTED" && (!input.creatorIds || input.creatorIds.length === 0)) {
      throw new ApiError(400, "Select at least one creator to export");
    }
    if (input.scope === "CONTACT_LIST" && !input.listId) throw new ApiError(400, "Choose a contact list");
    if (input.scope === "JOB" && !input.jobId) throw new ApiError(400, "Choose a processing job");
    if (input.scope === "CONTACT_LIST" && input.listId) {
      const list = await prisma.contactList.findUnique({ where: { id: input.listId } });
      if (!list) throw new ApiError(404, "Contact list not found");
      if (user.role !== "ADMIN" && list.userId !== user.id) throw new ApiError(403, "You do not have access to this list");
    }
    const name = `creators-${input.scope.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    const job = await prisma.processingJob.create({
      data: {
        type: "EXPORT_RESULTS",
        name: `Export ${input.scope.toLowerCase().replaceAll("_", " ")}`,
        userId: user.id,
        payload: { creatorIds: input.creatorIds ?? [], listId: input.listId, jobId: input.jobId },
      },
    });
    const record = await prisma.exportRecord.create({
      data: {
        scope: input.scope,
        fileName: name,
        filters: input.filters ?? {},
        userId: user.id,
        processingJobId: job.id,
      },
    });
    await queueJob(job.id);
    await audit(user.id, "export.start", "export", record.id, { scope: input.scope });
    return NextResponse.json({ export: record, processingJobId: job.id }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
