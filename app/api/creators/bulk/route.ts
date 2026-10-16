import { NextResponse } from "next/server";
import { jsonError, readJson, requireUser } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { bulkCreatorSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = bulkCreatorSchema.parse(await readJson(request));
    if (input.action === "delete") {
      const result = await prisma.creator.deleteMany({ where: { id: { in: input.creatorIds } } });
      await audit(user.id, "creator.bulk-delete", "creator", undefined, { count: result.count });
      return NextResponse.json({ count: result.count });
    }
    const result = await prisma.creator.updateMany({
      where: { id: { in: input.creatorIds } },
      data: { hidden: input.action === "hide" },
    });
    await audit(user.id, `creator.bulk-${input.action}`, "creator", undefined, { count: result.count });
    return NextResponse.json({ count: result.count });
  } catch (error) {
    return jsonError(error);
  }
}
