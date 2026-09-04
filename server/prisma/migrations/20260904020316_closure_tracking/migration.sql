-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "consecutiveMissCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstMissingAt" TIMESTAMP(3);
