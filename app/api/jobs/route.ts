import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
    const status = url.searchParams.get("status");
    const where = status ? { status: status as "QUEUED" } : {};
    const [total, jobs] = await prisma.$transaction([
      prisma.processingJob.count({ where }),
      prisma.processingJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({ jobs, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}
