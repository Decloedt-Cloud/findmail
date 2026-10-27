import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await requireUser();
    const icps = await prisma.brandIcp.findMany({
      select: { id: true, brandName: true, websiteUrl: true },
      orderBy: [{ brandName: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ icps });
  } catch (error) {
    return jsonError(error);
  }
}
