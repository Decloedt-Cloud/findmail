import { NextResponse } from "next/server";
import { ApiError, assertCanAccess, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { contactListSchema } from "@/lib/schemas";

async function loadList(id: string, user: { id: string; role: string }) {
  const list = await prisma.contactList.findUnique({
    where: { id },
    include: {
      _count: { select: { members: true } },
      members: {
        take: 100,
        orderBy: { createdAt: "desc" },
        include: {
          creator: {
            include: { emails: { take: 1, orderBy: { discoveredAt: "desc" } } },
          },
        },
      },
    },
  });
  if (!list) throw new ApiError(404, "Contact list not found");
  assertCanAccess(user, list.userId);
  return list;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const list = await loadList(id, user);
    return NextResponse.json({
      list: {
        ...list,
        members: list.members.map((member) => ({
          ...member,
          creator: { ...member.creator, viewCount: member.creator.viewCount?.toString() ?? null },
        })),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await prisma.contactList.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Contact list not found");
    assertCanAccess(user, existing.userId);
    const input = contactListSchema.parse(await readJson(request));
    const list = await prisma.contactList.update({ where: { id }, data: { name: input.name, notes: input.notes } });
    await audit(user.id, "list.update", "contactList", id);
    return NextResponse.json({ list });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await prisma.contactList.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Contact list not found");
    assertCanAccess(user, existing.userId);
    await prisma.contactList.delete({ where: { id } });
    await audit(user.id, "list.delete", "contactList", id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
