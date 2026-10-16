import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { cancelJob } from "@/lib/jobs/actions";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const search = await prisma.searchJob.findUnique({ where: { id } });
    if (!search?.processingJobId) throw new ApiError(404, "Search job not found");
    const job = await cancelJob(search.processingJobId, user.id);
    return NextResponse.json({ job });
  } catch (error) {
    return jsonError(error);
  }
}
