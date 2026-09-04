-- CreateEnum
CREATE TYPE "AccessBasis" AS ENUM ('OFFICIAL_API', 'RSS', 'PERMITTED_SCRAPE', 'WRITTEN_PERMISSION');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('GREENHOUSE', 'LEVER', 'WORKDAY', 'ICIMS', 'SMARTRECRUITERS', 'CUSTOM_HTML', 'RSS', 'API');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "accessBasis" "AccessBasis" NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_sources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "config" JSONB NOT NULL,
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 240,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE INDEX "job_sources_companyId_idx" ON "job_sources"("companyId");

-- AddForeignKey
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
