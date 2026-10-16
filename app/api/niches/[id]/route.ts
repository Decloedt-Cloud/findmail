import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const niche = await prisma.niche.findUnique({ where: { id } });
    if (!niche) throw new ApiError(404, "Niche not found");
    if (niche.isSystem) throw new ApiError(409, "Built-in niches stay available. Add a custom niche instead of deleting this one.");
    await prisma.niche.delete({ where: { id } });
    await audit(user.id, "niche.delete", "niche", id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
