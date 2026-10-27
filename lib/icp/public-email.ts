import { prisma } from "@/lib/db";
import { fetchPublicPage, fetchPublicText } from "@/lib/email/crawl";
import { EmailDiscoveryService } from "@/lib/email/discovery";
import { applyEmailOutcome } from "@/lib/jobs/discover";
import { logger } from "@/lib/logger";

const MAX_PAGES = 4;

export async function discoverPublicEmail(creatorId: string) {
  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: {
      id: true,
      description: true,
      channelUrl: true,
      officialWebsiteUrl: true,
      emailSearchStatus: true,
    },
  });
  if (!creator || creator.emailSearchStatus !== "NOT_SEARCHED") return { skipped: true as const };

  const discovery = new EmailDiscoveryService({
    maxPages: MAX_PAGES,
    fetchPage: fetchPublicPage,
    fetchText: fetchPublicText,
  });
  const outcome = await discovery.discover({
    description: creator.description,
    channelUrl: creator.channelUrl,
    existingWebsite: creator.officialWebsiteUrl,
  });
  const stored = await applyEmailOutcome(creator.id, outcome.website, outcome.emails, outcome.socials);
  logger.info("icp public email", {
    creatorId,
    found: outcome.emails.length,
    stored,
    website: Boolean(outcome.website.officialWebsiteUrl),
  });
  return { skipped: false as const, found: outcome.emails.length, stored };
}
