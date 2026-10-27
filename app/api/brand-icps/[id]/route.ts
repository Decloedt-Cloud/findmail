import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUser } from "@/lib/api";
import { readStoredIcp } from "@/lib/icp/snapshot";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const brand = await prisma.brandIcp.findUnique({
      where: { id },
      select: {
        id: true,
        brandName: true,
        websiteUrl: true,
        snapshot: true,
        analysisNote: true,
        searchQueries: true,
      },
    });
    if (!brand) throw new ApiError(404, "We couldn't find this ICP.");
    const stored = readStoredIcp(brand.snapshot);
    return NextResponse.json({
      icp: {
        id: brand.id,
        brandName: brand.brandName,
        websiteUrl: brand.websiteUrl,
        analysisNote: brand.analysisNote,
        searchQueries: brand.searchQueries,
        icps: stored.icps,
        offers: stored.offers,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
