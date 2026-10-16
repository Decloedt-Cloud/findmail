import { NextResponse } from "next/server";
import { ApiError, assertCanAccess, jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { mergeListsSchema } from "@/lib/schemas";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = mergeListsSchema.parse(await readJson(request));
    const [target, source] = await Promise.all([
      prisma.contactList.findUnique({ where: { id }, include: { members: { include: { creator: { include: { emails: true } } } } } }),
      prisma.contactList.findUnique({
        where: { id: input.sourceListId },
        include: { members: { include: { creator: { include: { emails: true } } } } },
      }),
    ]);
    if (!target || !source) throw new ApiError(404, "Contact list not found");
    assertCanAccess(user, target.userId);
    assertCanAccess(user, source.userId);
    const existingEmails = new Set(
      target.members.flatMap((member) => member.creator.emails.map((email) => email.normalizedEmail)),
    );
    const existingCreators = new Set(target.members.map((member) => member.creatorId));
    const additions = source.members.filter((member) => {
      if (existingCreators.has(member.creatorId)) return false;
      if (!input.excludeDuplicateEmails) return true;
      const emails = member.creator.emails.map((email) => email.normalizedEmail);
      if (emails.length === 0) return true;
      return emails.some((email) => !existingEmails.has(email));
    });
    const result = await prisma.contactListMember.createMany({
      data: additions.map((member) => ({ listId: id, creatorId: member.creatorId })),
      skipDuplicates: true,
    });
    await audit(user.id, "list.merge", "contactList", id, { source: source.id, added: result.count });
    return NextResponse.json({ added: result.count });
  } catch (error) {
    return jsonError(error);
  }
}
