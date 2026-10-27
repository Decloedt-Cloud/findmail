-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'MATCH_ICP_CHANNELS';

-- CreateTable
CREATE TABLE "BrandIcp" (
    "id" TEXT NOT NULL,
    "wayoOnboardingId" TEXT NOT NULL,
    "websiteUrl" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "countries" TEXT[],
    "snapshot" JSONB NOT NULL,
    "searchQueries" TEXT[],
    "analysisNote" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "videoTarget" INTEGER NOT NULL DEFAULT 30,
    "matchedVideoCount" INTEGER NOT NULL DEFAULT 0,
    "matchedChannelCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "processingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandIcp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpVideoMatch" (
    "id" TEXT NOT NULL,
    "brandIcpId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "videoTitle" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "videoDescription" TEXT,
    "publishedAt" TIMESTAMP(3),
    "searchQuery" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IcpVideoMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandIcp_wayoOnboardingId_key" ON "BrandIcp"("wayoOnboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandIcp_processingJobId_key" ON "BrandIcp"("processingJobId");

-- CreateIndex
CREATE INDEX "BrandIcp_websiteUrl_idx" ON "BrandIcp"("websiteUrl");

-- CreateIndex
CREATE INDEX "BrandIcp_status_idx" ON "BrandIcp"("status");

-- CreateIndex
CREATE INDEX "BrandIcp_createdAt_idx" ON "BrandIcp"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IcpVideoMatch_brandIcpId_youtubeVideoId_key" ON "IcpVideoMatch"("brandIcpId", "youtubeVideoId");

-- CreateIndex
CREATE INDEX "IcpVideoMatch_brandIcpId_creatorId_idx" ON "IcpVideoMatch"("brandIcpId", "creatorId");

-- CreateIndex
CREATE INDEX "IcpVideoMatch_creatorId_idx" ON "IcpVideoMatch"("creatorId");

-- AddForeignKey
ALTER TABLE "BrandIcp" ADD CONSTRAINT "BrandIcp_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpVideoMatch" ADD CONSTRAINT "IcpVideoMatch_brandIcpId_fkey" FOREIGN KEY ("brandIcpId") REFERENCES "BrandIcp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpVideoMatch" ADD CONSTRAINT "IcpVideoMatch_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
