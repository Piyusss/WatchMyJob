-- CreateEnum
CREATE TYPE "UserJobStateValue" AS ENUM ('SAVED', 'APPLIED', 'DISMISSED');

-- CreateTable
CREATE TABLE "user_job_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "state" "UserJobStateValue" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_job_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_job_states_userId_state_idx" ON "user_job_states"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "user_job_states_userId_jobId_key" ON "user_job_states"("userId", "jobId");

-- AddForeignKey
ALTER TABLE "user_job_states" ADD CONSTRAINT "user_job_states_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_job_states" ADD CONSTRAINT "user_job_states_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
