-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "NotificationStatus" ADD VALUE 'BOUNCED';
ALTER TYPE "NotificationStatus" ADD VALUE 'COMPLAINED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "bouncedAt" TIMESTAMP(3),
ADD COLUMN     "complainedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailHardBounced" BOOLEAN NOT NULL DEFAULT false;
