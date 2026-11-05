-- CreateTable
CREATE TABLE "company_leads" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "domain" TEXT,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "phone" TEXT,
    "mailingAddress" TEXT,
    "mailingCity" TEXT,
    "mailingState" TEXT,
    "mailingZip" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "sicCode" TEXT,
    "sicName" TEXT,
    "naicsCode" TEXT,
    "salesVolume" TEXT,
    "employeeCount" TEXT,
    "companyType" TEXT,
    "sourceFile" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_leads_emailNormalized_key" ON "company_leads"("emailNormalized");

-- CreateIndex
CREATE INDEX "company_leads_domain_idx" ON "company_leads"("domain");

-- CreateIndex
CREATE INDEX "company_leads_naicsCode_idx" ON "company_leads"("naicsCode");

-- CreateIndex
CREATE INDEX "company_leads_sicCode_idx" ON "company_leads"("sicCode");

-- CreateIndex
CREATE INDEX "company_leads_sicName_idx" ON "company_leads"("sicName");

-- CreateIndex
CREATE INDEX "company_leads_mailingState_idx" ON "company_leads"("mailingState");

-- CreateIndex
CREATE INDEX "company_leads_businessName_idx" ON "company_leads"("businessName");

-- CreateIndex
CREATE INDEX "company_leads_importBatchId_idx" ON "company_leads"("importBatchId");
