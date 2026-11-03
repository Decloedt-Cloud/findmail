import "../lib/load-env";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { hasPublicContact } from "../lib/creators/contact";

const BATCH = 100;
const apply = process.argv.includes("--apply");

function hasChannelIcp(value: unknown) {
  return value != null && value !== Prisma.DbNull;
}

async function main() {
  let cursor: string | null = null;
  let scanned = 0;
  let marked = 0;
  let deleted = 0;

  for (;;) {
    const rows: Array<{
      id: string;
      channelName: string;
      youtubeChannelId: string;
      channelIcp: unknown;
      instagramUrl: string | null;
      twitterUrl: string | null;
      tiktokUrl: string | null;
      emails: { id: string }[];
    }> = await prisma.creator.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: "asc" },
      take: BATCH,
      select: {
        id: true,
        channelName: true,
        youtubeChannelId: true,
        channelIcp: true,
        instagramUrl: true,
        twitterUrl: true,
        tiktokUrl: true,
        emails: {
          where: {
            verificationStatus: { notIn: ["INVALID", "NOT_FOUND"] },
            emailAddress: { not: "" },
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (rows.length === 0) break;

    for (const creator of rows) {
      scanned += 1;
      cursor = creator.id;
      const reachable = hasPublicContact({
        instagramUrl: creator.instagramUrl,
        twitterUrl: creator.twitterUrl,
        tiktokUrl: creator.tiktokUrl,
        emailCount: creator.emails.length,
      });
      if (reachable && hasChannelIcp(creator.channelIcp)) continue;
      marked += 1;
      console.log(
        `${apply ? "delete" : "would-delete"} ${creator.youtubeChannelId} · ${creator.channelName}` +
          `${reachable ? "" : " · no contact"}` +
          `${hasChannelIcp(creator.channelIcp) ? "" : " · no channel ICP"}`,
      );
      if (!apply) continue;
      await prisma.jobItem.updateMany({ where: { creatorId: creator.id }, data: { creatorId: null } });
      await prisma.creator.delete({ where: { id: creator.id } });
      deleted += 1;
    }
  }

  console.log(
    apply
      ? `Done. scanned=${scanned} deleted=${deleted}`
      : `Dry run. scanned=${scanned} would-delete=${marked}. Re-run with --apply to delete.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Prune failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
