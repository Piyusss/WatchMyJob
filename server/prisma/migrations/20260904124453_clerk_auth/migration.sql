-- Clerk becomes the sole auth mechanism (see auth/authenticate.ts). Every
-- existing user here is dev/test data authenticated the old, now-removed
-- way (password + custom JWT) -- there is no Clerk identity to backfill
-- clerkUserId from, so this clears the table rather than leaving orphaned
-- rows that could never satisfy the new required unique column. Cascades to
-- preferences, subscriptions and notifications (all onDelete: Cascade).
DELETE FROM "users";

-- DropForeignKey
ALTER TABLE "email_verification_tokens" DROP CONSTRAINT "email_verification_tokens_userId_fkey";

-- DropTable
DROP TABLE "email_verification_tokens";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "passwordHash",
ADD COLUMN "clerkUserId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkUserId_key" ON "users"("clerkUserId");
