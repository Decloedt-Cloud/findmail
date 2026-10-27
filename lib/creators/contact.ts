import { prisma } from "@/lib/db";

function filled(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

export function hasPublicContact(row: {
  instagramUrl?: string | null;
  twitterUrl?: string | null;
  tiktokUrl?: string | null;
  emailCount?: number;
}) {
  return (row.emailCount ?? 0) > 0 || filled(row.instagramUrl) || filled(row.twitterUrl) || filled(row.tiktokUrl);
}

/** Drop a creator when neither a public email nor a social profile was found. */
export async function discardCreatorIfUnreachable(creatorId: string): Promise<boolean> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      instagramUrl: true,
      twitterUrl: true,
      tiktokUrl: true,
      _count: { select: { emails: true } },
    },
  });
  if (!creator) return false;
  if (
    hasPublicContact({
      instagramUrl: creator.instagramUrl,
      twitterUrl: creator.twitterUrl,
      tiktokUrl: creator.tiktokUrl,
      emailCount: creator._count.emails,
    })
  ) {
    return false;
  }
  await prisma.jobItem.updateMany({ where: { creatorId }, data: { creatorId: null } });
  await prisma.creator.delete({ where: { id: creatorId } });
  return true;
}
