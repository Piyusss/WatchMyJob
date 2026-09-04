-- AlterTable
ALTER TABLE "job_sources" ADD COLUMN     "lastAttemptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "lastMatchRelevantChangeAt" TIMESTAMP(3);
