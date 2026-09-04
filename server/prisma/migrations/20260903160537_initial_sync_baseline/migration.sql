-- AlterTable
ALTER TABLE "job_sources" ADD COLUMN     "initialSyncCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "discoveredInInitialSync" BOOLEAN NOT NULL DEFAULT false;
