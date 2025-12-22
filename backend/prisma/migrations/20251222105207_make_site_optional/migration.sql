-- Drop existing foreign key
ALTER TABLE "Charger"
DROP CONSTRAINT IF EXISTS "Charger_siteId_fkey";

-- Make siteId nullable
ALTER TABLE "Charger"
ALTER COLUMN "siteId" DROP NOT NULL;

-- Recreate foreign key as optional
ALTER TABLE "Charger"
ADD CONSTRAINT "Charger_siteId_fkey"
FOREIGN KEY ("siteId")
REFERENCES "Site"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
