-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('YOUTUBE_SEARCH', 'CSV_IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNKNOWN', 'FOUND', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "SubscriberVisibility" AS ENUM ('PUBLIC', 'HIDDEN', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "EmailSearchStatus" AS ENUM ('NOT_SEARCHED', 'NOT_FOUND', 'FOUND', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "EmailVerificationStatus" AS ENUM ('DISCOVERED', 'SYNTAX_VALID', 'VERIFIED', 'INVALID', 'UNKNOWN', 'NOT_FOUND', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ConfidenceStatus" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "EmailSourceType" AS ENUM ('PUBLIC_PAGE', 'MAILTO', 'CHANNEL_DESCRIPTION', 'CSV_IMPORT', 'LICENSED_PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('MAILTO_LINK', 'VISIBLE_TEXT', 'CHANNEL_DESCRIPTION', 'CSV_COLUMN', 'PROVIDER_API', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('DISCOVER_CREATORS', 'IMPORT_CHANNELS', 'DISCOVER_WEBSITES', 'FIND_CONTACT_PAGES', 'EXTRACT_EMAILS', 'VERIFY_EMAILS', 'EXPORT_RESULTS');

-- CreateEnum
CREATE TYPE "ExportScope" AS ENUM ('FILTERED', 'SELECTED', 'WITH_EMAIL', 'VERIFIED_ONLY', 'WITHOUT_EMAIL', 'JOB', 'CONTACT_LIST');

-- CreateEnum
CREATE TYPE "DuplicateStrategy" AS ENUM ('SKIP', 'UPDATE', 'MERGE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Niche" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Niche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "channelHandle" TEXT,
    "channelUrl" TEXT NOT NULL,
    "description" TEXT,
    "country" TEXT,
    "discoveryRegion" TEXT,
    "language" TEXT,
    "subscriberCount" INTEGER,
    "subscriberVisibility" "SubscriberVisibility" NOT NULL DEFAULT 'UNAVAILABLE',
    "videoCount" INTEGER,
    "viewCount" BIGINT,
    "thumbnailUrl" TEXT,
    "officialWebsiteUrl" TEXT,
    "websiteStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "websiteEvidence" TEXT,
    "niche" TEXT,
    "keywords" TEXT[],
    "discoverySource" "DiscoverySource" NOT NULL DEFAULT 'YOUTUBE_SEARCH',
    "emailSearchStatus" "EmailSearchStatus" NOT NULL DEFAULT 'NOT_SEARCHED',
    "recentVideoPublishedAt" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMetadataSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailContact" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceType" "EmailSourceType" NOT NULL,
    "extractionMethod" "ExtractionMethod" NOT NULL,
    "confidenceStatus" "ConfidenceStatus" NOT NULL DEFAULT 'MEDIUM',
    "verificationStatus" "EmailVerificationStatus" NOT NULL DEFAULT 'DISCOVERED',
    "verificationProvider" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "isOnOfficialDomain" BOOLEAN NOT NULL DEFAULT false,
    "isGenericInbox" BOOLEAN NOT NULL DEFAULT false,
    "pageTitle" TEXT,
    "provenanceNote" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchJob" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "niche" TEXT,
    "countries" TEXT[],
    "language" TEXT,
    "minSubscribers" INTEGER,
    "maxSubscribers" INTEGER,
    "maxResults" INTEGER NOT NULL DEFAULT 50,
    "requirePublicEmail" BOOLEAN NOT NULL DEFAULT false,
    "recencyDays" INTEGER,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "noEmailCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "duplicatesPrevented" INTEGER NOT NULL DEFAULT 0,
    "quotaUsed" INTEGER NOT NULL DEFAULT 0,
    "nextPageToken" TEXT,
    "errorSummary" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "processingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "noEmailCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "duplicatesPrevented" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "payload" JSONB NOT NULL,
    "bullJobId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "creatorId" TEXT,
    "externalKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobError" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "recordKey" TEXT,
    "message" TEXT NOT NULL,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedFilePath" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "duplicateStrategy" "DuplicateStrategy" NOT NULL DEFAULT 'SKIP',
    "columnMapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorReportPath" TEXT,
    "userId" TEXT,
    "processingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "scope" "ExportScope" NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB,
    "userId" TEXT,
    "processingJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactListMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactListMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DedupEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DedupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Niche_name_key" ON "Niche"("name");

-- CreateIndex
CREATE INDEX "Niche_name_idx" ON "Niche"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_youtubeChannelId_key" ON "Creator"("youtubeChannelId");

-- CreateIndex
CREATE INDEX "Creator_country_idx" ON "Creator"("country");

-- CreateIndex
CREATE INDEX "Creator_niche_idx" ON "Creator"("niche");

-- CreateIndex
CREATE INDEX "Creator_subscriberCount_idx" ON "Creator"("subscriberCount");

-- CreateIndex
CREATE INDEX "Creator_discoveredAt_idx" ON "Creator"("discoveredAt");

-- CreateIndex
CREATE INDEX "Creator_hidden_idx" ON "Creator"("hidden");

-- CreateIndex
CREATE INDEX "Creator_emailSearchStatus_idx" ON "Creator"("emailSearchStatus");

-- CreateIndex
CREATE INDEX "Creator_discoverySource_idx" ON "Creator"("discoverySource");

-- CreateIndex
CREATE INDEX "EmailContact_normalizedEmail_idx" ON "EmailContact"("normalizedEmail");

-- CreateIndex
CREATE INDEX "EmailContact_verificationStatus_idx" ON "EmailContact"("verificationStatus");

-- CreateIndex
CREATE INDEX "EmailContact_discoveredAt_idx" ON "EmailContact"("discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailContact_creatorId_normalizedEmail_key" ON "EmailContact"("creatorId", "normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "SearchJob_processingJobId_key" ON "SearchJob"("processingJobId");

-- CreateIndex
CREATE INDEX "SearchJob_status_idx" ON "SearchJob"("status");

-- CreateIndex
CREATE INDEX "SearchJob_createdAt_idx" ON "SearchJob"("createdAt");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_idx" ON "ProcessingJob"("status");

-- CreateIndex
CREATE INDEX "ProcessingJob_type_idx" ON "ProcessingJob"("type");

-- CreateIndex
CREATE INDEX "ProcessingJob_createdAt_idx" ON "ProcessingJob"("createdAt");

-- CreateIndex
CREATE INDEX "ProcessingJob_userId_idx" ON "ProcessingJob"("userId");

-- CreateIndex
CREATE INDEX "JobItem_jobId_status_idx" ON "JobItem"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobItem_jobId_externalKey_key" ON "JobItem"("jobId", "externalKey");

-- CreateIndex
CREATE INDEX "JobError_jobId_idx" ON "JobError"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_processingJobId_key" ON "ImportBatch"("processingJobId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportRecord_processingJobId_key" ON "ExportRecord"("processingJobId");

-- CreateIndex
CREATE INDEX "ExportRecord_createdAt_idx" ON "ExportRecord"("createdAt");

-- CreateIndex
CREATE INDEX "ExportRecord_userId_idx" ON "ExportRecord"("userId");

-- CreateIndex
CREATE INDEX "ContactList_userId_idx" ON "ContactList"("userId");

-- CreateIndex
CREATE INDEX "ContactList_name_idx" ON "ContactList"("name");

-- CreateIndex
CREATE INDEX "ContactListMember_creatorId_idx" ON "ContactListMember"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactListMember_listId_creatorId_key" ON "ContactListMember"("listId", "creatorId");

-- CreateIndex
CREATE INDEX "ApiUsage_provider_createdAt_idx" ON "ApiUsage"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_idx" ON "AuditEvent"("userId");

-- CreateIndex
CREATE INDEX "DedupEvent_kind_createdAt_idx" ON "DedupEvent"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailContact" ADD CONSTRAINT "EmailContact_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchJob" ADD CONSTRAINT "SearchJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchJob" ADD CONSTRAINT "SearchJob_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobItem" ADD CONSTRAINT "JobItem_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobError" ADD CONSTRAINT "JobError_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "ProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactList" ADD CONSTRAINT "ContactList_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactListMember" ADD CONSTRAINT "ContactListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ContactList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactListMember" ADD CONSTRAINT "ContactListMember_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
