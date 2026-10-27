import { NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await requireUser();
    const countries = await prisma.creator.findMany({
      where: { hidden: false, country: { not: null } },
      distinct: ["country"],
      select: { country: true },
    });
    return NextResponse.json({
      countries: countries.map((row) => row.country).filter((value): value is string => Boolean(value)),
    });
  } catch (error) {
    return jsonError(error);
  }
}
