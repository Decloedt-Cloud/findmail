import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const job = await prisma.searchJob.findUnique({
      where: { id },
      include: { processingJob: { include: { errors: { orderBy: { createdAt: "desc" }, take: 50 } } } },
    });
    if (!job) throw new ApiError(404, "Search job not found");
    return NextResponse.json({ job });
  } catch (error) {
    return jsonError(error);
  }
}
