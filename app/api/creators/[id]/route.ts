import { NextResponse } from "next/server";
import { ApiError, jsonError, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { creatorInclude, serializeCreator } from "@/lib/creators/query";
import { prisma } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const creator = await prisma.creator.findUnique({ where: { id }, include: creatorInclude });
    if (!creator || creator.hidden) throw new ApiError(404, "Creator not found");
    return NextResponse.json({ creator: serializeCreator(creator) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const creator = await prisma.creator.findUnique({ where: { id } });
    if (!creator) throw new ApiError(404, "Creator not found");
    await prisma.creator.delete({ where: { id } });
    await audit(user.id, "creator.delete", "creator", id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = (await request.json()) as { hidden?: boolean };
    if (typeof body.hidden !== "boolean") throw new ApiError(400, "hidden must be true or false");
    const creator = await prisma.creator.update({ where: { id }, data: { hidden: body.hidden } });
    await audit(user.id, body.hidden ? "creator.hide" : "creator.restore", "creator", id);
    return NextResponse.json({ creator: { ...creator, viewCount: creator.viewCount?.toString() ?? null } });
  } catch (error) {
    return jsonError(error);
  }
}
