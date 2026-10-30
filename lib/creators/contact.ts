import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const UNUSABLE_EMAIL = ["INVALID", "NOT_FOUND"] as const;

function filled(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

export function hasPublicContact(row: {
  instagramUrl?: string | null;
  twitterUrl?: string | null;
  tiktokUrl?: string | null;
  /** Count of emails that are not INVALID / NOT_FOUND. */
  emailCount?: number;
}) {
  return (row.emailCount ?? 0) > 0 || filled(row.instagramUrl) || filled(row.twitterUrl) || filled(row.tiktokUrl);
}

function hasChannelIcp(value: unknown) {
  return value != null && value !== Prisma.DbNull;
}

/**
 * Drop a creator when there is no usable public contact, or when channel ICP is missing.
 * INVALID / NOT_FOUND emails do not count as contact.
 */
export async function discardCreatorIfUnreachable(creatorId: string): Promise<boolean> {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      channelIcp: true,
      instagramUrl: true,
      twitterUrl: true,
      tiktokUrl: true,
      emails: {
        where: { verificationStatus: { notIn: [...UNUSABLE_EMAIL] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!creator) return false;
  const reachable = hasPublicContact({
    instagramUrl: creator.instagramUrl,
    twitterUrl: creator.twitterUrl,
    tiktokUrl: creator.tiktokUrl,
    emailCount: creator.emails.length,
  });
  if (reachable && hasChannelIcp(creator.channelIcp)) return false;
  await prisma.jobItem.updateMany({ where: { creatorId }, data: { creatorId: null } });
  await prisma.creator.delete({ where: { id: creatorId } });
  return true;
}
