-- Keep one row per channel found for an ICP, then drop the stored videos.

CREATE TABLE "IcpChannelMatch" (
    "id" TEXT NOT NULL,
    "brandIcpId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcpChannelMatch_pkey" PRIMARY KEY ("id")
);

INSERT INTO "IcpChannelMatch" ("id", "brandIcpId", "creatorId", "createdAt")
SELECT
    substr(md5("brandIcpId" || ':' || "creatorId"), 1, 25),
    "brandIcpId",
    "creatorId",
    MIN("createdAt")
FROM "IcpVideoMatch"
GROUP BY "brandIcpId", "creatorId";

UPDATE "Creator" AS creator
SET
    "matchedVideoTitle" = NULL,
    "matchedVideoUrl" = NULL,
    "matchedVideoPublishedAt" = NULL
FROM "IcpVideoMatch" AS video
WHERE creator."id" = video."creatorId"
  AND creator."matchedVideoUrl" = video."videoUrl";

UPDATE "BrandIcp" AS brand
SET "matchedChannelCount" = (
    SELECT COUNT(*)::int FROM "IcpChannelMatch" AS match WHERE match."brandIcpId" = brand."id"
);

DROP TABLE "IcpVideoMatch";

ALTER TABLE "BrandIcp" DROP COLUMN "matchedVideoCount";
ALTER TABLE "BrandIcp" DROP COLUMN "videoTarget";

CREATE UNIQUE INDEX "IcpChannelMatch_brandIcpId_creatorId_key" ON "IcpChannelMatch"("brandIcpId", "creatorId");
CREATE INDEX "IcpChannelMatch_creatorId_idx" ON "IcpChannelMatch"("creatorId");

ALTER TABLE "IcpChannelMatch" ADD CONSTRAINT "IcpChannelMatch_brandIcpId_fkey" FOREIGN KEY ("brandIcpId") REFERENCES "BrandIcp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IcpChannelMatch" ADD CONSTRAINT "IcpChannelMatch_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
