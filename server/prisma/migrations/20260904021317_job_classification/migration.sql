-- CreateEnum
CREATE TYPE "ExperienceStatus" AS ENUM ('KNOWN', 'UNKNOWN');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "experienceStatus" "ExperienceStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "opportunityType" "OpportunityType" NOT NULL DEFAULT 'FULL_TIME',
ADD COLUMN     "preferredExperienceMax" INTEGER,
ADD COLUMN     "preferredExperienceMin" INTEGER,
ADD COLUMN     "requiredExperienceMax" INTEGER,
ADD COLUMN     "requiredExperienceMin" INTEGER;
