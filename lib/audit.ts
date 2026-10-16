import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function audit(
  userId: string | null | undefined,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
) {
  await prisma.auditEvent.create({
    data: {
      userId: userId ?? null,
      action,
      entityType,
      entityId,
      metadata: (metadata as Prisma.InputJsonValue | undefined) ?? undefined,
    },
  });
}
