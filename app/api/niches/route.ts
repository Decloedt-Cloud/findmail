import { NextResponse } from "next/server";
import { jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { nicheSchema } from "@/lib/schemas";

export async function GET() {
  try {
    await requireUser();
    const niches = await prisma.niche.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ niches });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = nicheSchema.parse(await readJson(request));
    const niche = await prisma.niche.create({ data: { name: input.name, keywords: input.keywords, isSystem: false } });
    await audit(user.id, "niche.create", "niche", niche.id);
    return NextResponse.json({ niche }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
