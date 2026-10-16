import { NextResponse } from "next/server";
import { ApiError, assertCanAccess, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { listMembersSchema } from "@/lib/schemas";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const list = await prisma.contactList.findUnique({ where: { id } });
    if (!list) throw new ApiError(404, "Contact list not found");
    assertCanAccess(user, list.userId);
    const input = listMembersSchema.parse(await readJson(request));
    if (input.action === "remove") {
      const result = await prisma.contactListMember.deleteMany({ where: { listId: id, creatorId: { in: input.creatorIds } } });
      await audit(user.id, "list.remove", "contactList", id, { count: result.count });
      return NextResponse.json({ count: result.count });
    }
    const creators = await prisma.creator.findMany({ where: { id: { in: input.creatorIds }, hidden: false }, select: { id: true } });
    const result = await prisma.contactListMember.createMany({
      data: creators.map((creator) => ({ listId: id, creatorId: creator.id })),
      skipDuplicates: true,
    });
    await audit(user.id, "list.add", "contactList", id, { count: result.count });
    return NextResponse.json({ count: result.count });
  } catch (error) {
    return jsonError(error);
  }
}
