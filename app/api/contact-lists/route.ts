import { NextResponse } from "next/server";
import { jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { contactListSchema } from "@/lib/schemas";

export async function GET() {
  try {
    const user = await requireUser();
    const lists = await prisma.contactList.findMany({
      where: user.role === "ADMIN" ? {} : { userId: user.id },
      include: { _count: { select: { members: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ lists });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = contactListSchema.parse(await readJson(request));
    const list = await prisma.contactList.create({
      data: { name: input.name, notes: input.notes, userId: user.id },
    });
    await audit(user.id, "list.create", "contactList", list.id);
    return NextResponse.json({ list }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
