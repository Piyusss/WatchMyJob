-- AlterEnum
ALTER TYPE "SourcePlatform" ADD VALUE 'CUSTOM_TEST';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "isTestCompany" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "custom_test_jobs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "roleFamily" TEXT NOT NULL,
    "level" TEXT,
    "workMode" "WorkMode",
    "opportunityType" "OpportunityType" NOT NULL DEFAULT 'FULL_TIME',
    "requiredExperienceMin" INTEGER,
    "requiredExperienceMax" INTEGER,
    "description" TEXT,
    "applicationUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_test_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_test_job_locations" (
    "id" TEXT NOT NULL,
    "customTestJobId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "stateCode" TEXT,
    "stateName" TEXT,
    "cityName" TEXT,

    CONSTRAINT "custom_test_job_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_test_jobs_sourceId_idx" ON "custom_test_jobs"("sourceId");

-- CreateIndex
CREATE INDEX "custom_test_job_locations_customTestJobId_idx" ON "custom_test_job_locations"("customTestJobId");

-- AddForeignKey
ALTER TABLE "custom_test_jobs" ADD CONSTRAINT "custom_test_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_test_job_locations" ADD CONSTRAINT "custom_test_job_locations_customTestJobId_fkey" FOREIGN KEY ("customTestJobId") REFERENCES "custom_test_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
