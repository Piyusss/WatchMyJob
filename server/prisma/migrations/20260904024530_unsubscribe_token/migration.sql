-- Add nullable first: cuid() is a Prisma-client-side default, so it can't
-- backfill the 9 existing rows via a plain ADD COLUMN NOT NULL. Backfill
-- with pgcrypto's gen_random_uuid() (already available on modern Postgres,
-- no extension needed on 16+) for existing rows, then tighten to NOT NULL.
ALTER TABLE "users" ADD COLUMN "unsubscribeToken" TEXT;

UPDATE "users" SET "unsubscribeToken" = gen_random_uuid()::text WHERE "unsubscribeToken" IS NULL;

ALTER TABLE "users" ALTER COLUMN "unsubscribeToken" SET NOT NULL;

CREATE UNIQUE INDEX "users_unsubscribeToken_key" ON "users"("unsubscribeToken");
