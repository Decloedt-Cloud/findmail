-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "lastActiveAt" TIMESTAMP(3),
ADD COLUMN "averageViews" INTEGER,
ADD COLUMN "averageViewsMethod" TEXT,
ADD COLUMN "instagramUrl" TEXT,
ADD COLUMN "twitterUrl" TEXT,
ADD COLUMN "tiktokUrl" TEXT,
ADD COLUMN "matchedVideoTitle" TEXT,
ADD COLUMN "matchedVideoUrl" TEXT,
ADD COLUMN "matchedVideoViews" INTEGER,
ADD COLUMN "matchedVideoPublishedAt" TIMESTAMP(3);
