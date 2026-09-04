-- AlterTable
-- Dropping country/state/city rather than migrating them: they were
-- free-text (no canonical code), and pre-launch there's exactly one row
-- with a non-null value here ("germany") -- not worth a backfill script for
-- one row that doesn't map cleanly onto the new curated country list
-- anyway. The user re-picks from the new location UI.
ALTER TABLE "user_preferences" DROP COLUMN "country",
DROP COLUMN "state",
DROP COLUMN "city";

-- CreateTable
CREATE TABLE "user_preference_locations" (
    "id" TEXT NOT NULL,
    "userPreferencesId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "stateCode" TEXT,
    "stateName" TEXT,
    "cityName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preference_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_preference_locations_userPreferencesId_idx" ON "user_preference_locations"("userPreferencesId");

-- AddForeignKey
ALTER TABLE "user_preference_locations" ADD CONSTRAINT "user_preference_locations_userPreferencesId_fkey" FOREIGN KEY ("userPreferencesId") REFERENCES "user_preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
