import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { ApiError, assertCanAccess, jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { insideDir, paths } from "@/lib/paths";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const batch = await prisma.importBatch.findUnique({ where: { id } });
    if (!batch) throw new ApiError(404, "Import not found");
    assertCanAccess(user, batch.userId);
    if (!batch.errorReportPath || !insideDir(paths.imports, batch.errorReportPath)) {
      throw new ApiError(404, "This import has no error report");
    }
    const body = await readFile(batch.errorReportPath);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${batch.id}-errors.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
