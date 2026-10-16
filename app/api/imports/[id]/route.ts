import { NextResponse } from "next/server";
import { ApiError, assertCanAccess, jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const batch = await prisma.importBatch.findUnique({ where: { id }, include: { processingJob: true } });
    if (!batch) throw new ApiError(404, "Import not found");
    assertCanAccess(user, batch.userId);
    return NextResponse.json({ import: batch });
  } catch (error) {
    return jsonError(error);
  }
}
