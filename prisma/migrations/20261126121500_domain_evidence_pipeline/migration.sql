ALTER TABLE "Creator"
ADD COLUMN "recentPublicVideos" JSONB;

ALTER TABLE "BrandIcp"
ADD COLUMN "domainProfile" JSONB,
ADD COLUMN "domainInputHash" TEXT;

ALTER TABLE "IcpChannelMatch"
ADD COLUMN "domainMatch" JSONB;
