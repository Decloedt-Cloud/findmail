import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { ApiError, assertCanAccess, jsonError, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { insideDir, paths } from "@/lib/paths";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const record = await prisma.exportRecord.findUnique({ where: { id }, include: { processingJob: true } });
    if (!record) throw new ApiError(404, "Export not found");
    assertCanAccess(user, record.userId);
    const download = new URL(request.url).pathname.endsWith("/download");
    if (!download) return NextResponse.json({ export: record });
    if (!record.filePath || record.status !== "COMPLETED" || !insideDir(paths.exports, record.filePath)) {
      throw new ApiError(409, "This export is not ready to download");
    }
    if (record.expiresAt && record.expiresAt < new Date()) throw new ApiError(410, "This export has expired");
    const body = await readFile(record.filePath);
    await audit(user.id, "export.download", "export", record.id);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${record.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
