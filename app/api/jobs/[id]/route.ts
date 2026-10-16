import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const job = await prisma.processingJob.findUnique({
      where: { id },
      include: {
        errors: { orderBy: { createdAt: "desc" }, take: 100 },
        items: { orderBy: { updatedAt: "desc" }, take: 50 },
        searchJob: true,
        importBatch: true,
        exportRecord: true,
      },
    });
    if (!job) throw new ApiError(404, "Job not found");
    return NextResponse.json({ job });
  } catch (error) {
    return jsonError(error);
  }
}
