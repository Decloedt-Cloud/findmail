import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
    const q = url.searchParams.get("q")?.trim();
    const status = url.searchParams.get("status");
    const where = {
      ...(q ? { normalizedEmail: { contains: q.toLowerCase() } } : {}),
      ...(status ? { verificationStatus: status as "SYNTAX_VALID" } : {}),
      creator: { hidden: false },
    };
    const [total, emails] = await prisma.$transaction([
      prisma.emailContact.count({ where }),
      prisma.emailContact.findMany({
        where,
        include: { creator: { select: { id: true, channelName: true, channelUrl: true, country: true, niche: true } } },
        orderBy: { discoveredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return NextResponse.json({ emails, total, page, pageSize });
  } catch (error) {
    return jsonError(error);
  }
}
